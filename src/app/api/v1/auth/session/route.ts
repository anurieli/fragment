import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { verifyCodexIdToken, InvalidCodexToken } from "@/lib/server/codex-verify";
import { signIn, signOut, getSessionUser, setSessionCookie } from "@/lib/server/session";
import { guardJsonMutation, isCrossSite, crossSiteRefused } from "@/lib/server/csrf";

// node:crypto and the pg driver — never the edge runtime.
export const runtime = "nodejs";

/**
 * The session resource.
 *
 *   POST   — exchange a verified Codex id_token for a session cookie
 *   GET    — who am I (null when signed out)
 *   DELETE — revoke this session
 *
 * When no database is configured this is a self-hosted or desktop build with
 * no cloud behind it. That is a supported shape, so GET answers "signed out"
 * rather than failing; only the mutating verbs report that there is nothing
 * to sign in to.
 */

function cloudUnavailable() {
  return NextResponse.json(
    { error: "This Fragment build has no cloud configured." },
    { status: 503 },
  );
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) return cloudUnavailable();

  // Minting a session is the one request an attacker's page most wants to
  // make on a victim's behalf: it does not need a stolen cookie, it plants
  // one. See src/lib/server/csrf.ts for why Lax alone does not cover this.
  const refused = guardJsonMutation(req);
  if (refused) return refused;

  let idToken: string | undefined;
  try {
    ({ idToken } = (await req.json()) as { idToken?: string });
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (!idToken) {
    return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
  }

  try {
    const identity = await verifyCodexIdToken(idToken);
    const { user, token, expiresAt } = await signIn(
      identity,
      req.headers.get("user-agent"),
    );
    await setSessionCookie(token, expiresAt);
    return NextResponse.json({ user });
  } catch (err) {
    if (err instanceof InvalidCodexToken) {
      // Deliberately vague to the caller; the reason is for our logs only.
      console.warn("[auth] rejected id_token:", err.message);
      return NextResponse.json({ error: "Sign-in failed" }, { status: 401 });
    }
    console.error("[auth] sign-in error:", err);
    return NextResponse.json({ error: "Sign-in failed" }, { status: 500 });
  }
}

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}

export async function DELETE(req: NextRequest) {
  if (!isDatabaseConfigured()) return cloudUnavailable();
  // No JSON body to require here, but a cross-site page should not be able to
  // sign someone out either. DELETE is not reachable from a plain form, so
  // this is cheap belt-and-braces rather than the load-bearing check.
  if (isCrossSite(req)) return crossSiteRefused();
  await signOut();
  return NextResponse.json({ ok: true });
}
