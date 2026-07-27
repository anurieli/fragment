import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { query, queryOne, isDatabaseConfigured } from "./db";
import type { VerifiedCodexIdentity } from "./codex-verify";

/**
 * Sessions.
 *
 * Server-side rather than a stateless JWT, because "sign out everywhere" and
 * "revoke the laptop I left on a train" have to actually work, and a signed
 * token that has already been handed out cannot be recalled. The cost is a
 * lookup per request, which is one indexed primary-key hit.
 *
 * The cookie carries a random 256-bit value; the database stores only its
 * SHA-256. Anyone who reads the sessions table therefore learns nothing they
 * can present as a session. That is also why there is no "session token"
 * column to log or leak.
 */

export const SESSION_COOKIE = "fragment_session";
const SESSION_TTL_DAYS = 60;

export interface SessionUser {
  id: string;
  codexSub: string;
  email: string | null;
  name: string | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cookie flags. Secure is off only for plain-http local development. */
function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.SESSION_COOKIE_SECURE !== "false",
    path: "/",
    expires,
  };
}

/**
 * Find or create the user behind a verified identity, then start a session.
 *
 * Keyed on `sub`, never on email: people change their email address, and two
 * accounts must not collide because someone reused an address.
 */
export async function signIn(
  identity: VerifiedCodexIdentity,
  userAgent: string | null,
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const user = await queryOne<{
    id: string;
    codex_sub: string;
    email: string | null;
    name: string | null;
  }>(
    `insert into users (codex_sub, email, name)
     values ($1, $2, $3)
     on conflict (codex_sub) do update
       set email      = coalesce(excluded.email, users.email),
           name       = coalesce(excluded.name, users.name),
           updated_at = now()
     returning id, codex_sub, email, name`,
    [identity.sub, identity.email, identity.name],
  );

  if (!user) throw new Error("Failed to upsert user");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `insert into sessions (id, user_id, user_agent, expires_at) values ($1, $2, $3, $4)`,
    [hashToken(token), user.id, userAgent, expiresAt],
  );

  return {
    user: { id: user.id, codexSub: user.codex_sub, email: user.email, name: user.name },
    token,
    expiresAt,
  };
}

/** Attach the session cookie to the response. */
export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions(expiresAt));
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", cookieOptions(new Date(0)));
}

/**
 * The session token this request carries.
 *
 * The cookie is how browsers present it. The bearer header exists for clients
 * that are not same-origin browsers: the Tauri desktop build runs on its own
 * scheme and a SameSite=Lax cookie is never sent from there, so without this
 * the desktop app could authenticate and then be unable to prove it.
 */
async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  const fromCookie = jar.get(SESSION_COOKIE)?.value;
  if (fromCookie) return fromCookie;

  const header = (await headers()).get("authorization");
  if (header?.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token) return token;
  }

  return null;
}

/**
 * The current user, or null.
 *
 * Returns null rather than throwing when the cloud is not configured at all,
 * so that a self-hosted build with no database behaves like a signed-out one
 * instead of erroring on every request.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isDatabaseConfigured()) return null;

  const token = await readSessionToken();
  if (!token) return null;

  const row = await queryOne<{
    id: string;
    codex_sub: string;
    email: string | null;
    name: string | null;
  }>(
    `select u.id, u.codex_sub, u.email, u.name
       from sessions s
       join users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()`,
    [hashToken(token)],
  );

  if (!row) return null;
  return { id: row.id, codexSub: row.codex_sub, email: row.email, name: row.name };
}

/** Revoke the session this request presents. */
export async function signOut(): Promise<void> {
  if (!isDatabaseConfigured()) return;

  const token = await readSessionToken();
  if (token) {
    await query("delete from sessions where id = $1", [hashToken(token)]);
  }
  await clearSessionCookie();
}

/** Housekeeping: drop expired rows. Safe to call from a cron or a route. */
export async function pruneExpiredSessions(): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  const rows = await query<{ id: string }>(
    "delete from sessions where expires_at <= now() returning id",
  );
  return rows.length;
}
