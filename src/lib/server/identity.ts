import { queryOne } from "./db";

/**
 * A verified identity from any provider, in the shape `signIn` needs.
 *
 * Each provider's own verification module produces its own richer type and
 * narrows it to this before calling `signIn`. This module never verifies
 * anything itself — it exists to resolve an already-trusted
 * `(provider, subject)` pair to a user row, nothing more.
 *
 * Codex/ChatGPT is deliberately not such a provider. Its credential exists
 * only to route AI calls (src/hooks/use-codex-signin.ts); it must never
 * reach `signIn`. Google, landing with ARI-229, will be the first and only
 * caller of this until a second provider is added.
 */
export interface VerifiedIdentity {
  provider: string;
  subject: string;
  email: string | null;
  name: string | null;
}

export interface IdentityUser {
  id: string;
  email: string | null;
  name: string | null;
}

/**
 * Find or create the user behind a verified identity.
 *
 * One `(provider, subject)` maps to at most one user, and a fresh pair always
 * creates a fresh user. There is deliberately no lookup-by-email fallback: if
 * the same person later signs in with Google having only ever used ChatGPT
 * before, that is a *linking* decision, not something to infer silently from
 * a shared address, since email addresses get reused and reassigned. Account
 * linking is real scope for ARI-229's better-auth work, not this function.
 *
 * `users.email`/`.name` are a display cache, refreshed from whichever
 * identity most recently supplied a non-null value, and never treated as the
 * source of truth for "who is this."
 */
export async function findOrCreateUser(identity: VerifiedIdentity): Promise<IdentityUser> {
  const existing = await queryOne<{ user_id: string }>(
    "select user_id from identities where provider = $1 and subject = $2",
    [identity.provider, identity.subject],
  );

  if (existing) {
    const user = await queryOne<{ id: string; email: string | null; name: string | null }>(
      `update users
          set email      = coalesce($2, email),
              name       = coalesce($3, name),
              updated_at = now()
        where id = $1
        returning id, email, name`,
      [existing.user_id, identity.email, identity.name],
    );
    if (!user) throw new Error("Identity pointed at a user that no longer exists");
    return user;
  }

  const user = await queryOne<{ id: string; email: string | null; name: string | null }>(
    "insert into users (email, name) values ($1, $2) returning id, email, name",
    [identity.email, identity.name],
  );
  if (!user) throw new Error("Failed to create user");

  await queryOne(
    "insert into identities (user_id, provider, subject) values ($1, $2, $3) returning id",
    [user.id, identity.provider, identity.subject],
  );

  return user;
}
