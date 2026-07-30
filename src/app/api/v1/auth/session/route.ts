import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { signOut, getSessionUser } from "@/lib/server/session";
import { isCrossSite, crossSiteRefused } from "@/lib/server/csrf";

// node:crypto and the pg driver — never the edge runtime.
export const runtime = "nodejs";

/**
 * The session resource.
 *
 *   GET    — who am I (null when signed out)
 *   DELETE — revoke this session
 *
 * There is deliberately no POST here. Fragment's Codex/ChatGPT credential
 * exists for one purpose only: routing AI calls (`src/hooks/use-codex-signin.ts`
 * stores `codexAccessToken`/`codexRefreshToken` for that and nothing else).
 * It must never be able to mint a Fragment session — Ariel, 2026-07-30,
 * directly: "the ONLY use of that credential is for codex routing." A prior
 * version of this route accepted a verified Codex `id_token` and signed the
 * caller into Fragment with it; that path is gone, not merely unused, so
 * there is no live endpoint that still does it even if something upstream
 * were to send an id_token here again.
 *
 * Signing in to Fragment itself lands with Google (ARI-229): the route will
 * gain a POST back that verifies a Google credential and calls `signIn()`
 * from src/lib/server/session.ts with `{ provider: "google", ... }`. Until
 * then, hosted Fragment has no sign-in path, which is the correct state
 * rather than a stopgap ChatGPT one.
 *
 * When no database is configured this is a self-hosted or desktop build with
 * no cloud behind it. GET answers "signed out" rather than failing; DELETE
 * reports that there is nothing to sign out of.
 */

export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ user });
}

export async function DELETE(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "This Fragment build has no cloud configured." },
      { status: 503 },
    );
  }
  // No JSON body to require here, but a cross-site page should not be able to
  // sign someone out either. DELETE is not reachable from a plain form, so
  // this is cheap belt-and-braces rather than the load-bearing check.
  if (isCrossSite(req)) return crossSiteRefused();
  await signOut();
  return NextResponse.json({ ok: true });
}
