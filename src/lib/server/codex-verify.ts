import { createRemoteJWKSet, jwtVerify } from "jose";
import { CODEX_CLIENT_ID } from "@/lib/codex-auth";
import type { CodexIdentity } from "@/lib/codex-api";

/**
 * Verify a Codex `id_token` before believing anything it says.
 *
 * `extractCodexIdentity` on the client decodes the same claims, but decoding
 * is not verification: a JWT payload is base64, not a secret, so anyone can
 * hand the server a token claiming any `sub` they like. Since `sub` is the
 * primary key for an account, trusting an unverified one would let a caller
 * sign in as any user by editing a string. This module is the only place
 * allowed to turn a token into an identity the server acts on.
 */

const ISSUER = "https://auth.openai.com";
const JWKS_URL = new URL("https://auth.openai.com/.well-known/jwks.json");

// createRemoteJWKSet caches the key set and refetches on unknown `kid`, so
// this is one network round trip per key rotation, not per sign-in.
const jwks = createRemoteJWKSet(JWKS_URL, {
  cooldownDuration: 30_000,
  cacheMaxAge: 10 * 60_000,
});

/** A CodexIdentity the server has actually verified, plus the display name. */
export interface VerifiedCodexIdentity extends CodexIdentity {
  name: string | null;
}

export class InvalidCodexToken extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCodexToken";
  }
}

/**
 * Returns the verified identity, or throws InvalidCodexToken.
 *
 * Checks signature against OpenAI's published keys, the issuer, the audience
 * (a token minted for a different client is not ours to accept), and
 * expiry — jwtVerify enforces `exp`/`nbf` itself.
 */
export async function verifyCodexIdToken(idToken: string): Promise<VerifiedCodexIdentity> {
  if (!idToken || typeof idToken !== "string") {
    throw new InvalidCodexToken("No token supplied");
  }

  let payload: Record<string, unknown>;
  try {
    const verified = await jwtVerify(idToken, jwks, {
      issuer: ISSUER,
      audience: CODEX_CLIENT_ID,
      clockTolerance: 60,
    });
    payload = verified.payload as Record<string, unknown>;
  } catch (err) {
    const reason = err instanceof Error ? err.message : "verification failed";
    throw new InvalidCodexToken(reason);
  }

  const sub = typeof payload.sub === "string" ? payload.sub : null;
  if (!sub) throw new InvalidCodexToken("Token has no subject");

  const email = typeof payload.email === "string" ? payload.email : null;

  // The ChatGPT account id is a workspace hint, not an identity. It is kept
  // for later tenant work but never used to key a user.
  const authClaim = payload["https://api.openai.com/auth"];
  const accountId =
    authClaim && typeof authClaim === "object"
      ? ((authClaim as Record<string, unknown>).chatgpt_account_id as string | undefined) ?? null
      : null;

  const name = typeof payload.name === "string" ? payload.name : null;

  return { sub, email, accountId, name };
}
