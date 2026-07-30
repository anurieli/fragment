import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { guardJsonMutation } from "@/lib/server/csrf";
import { checkRateLimit, rateLimitResponse, getClientIp } from "@/lib/api-guards";
import {
  findShareByToken,
  identifyGuest,
  looksLikeEmail,
  guestCookieName,
} from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * "Who's reviewing?" — the entire signup flow for a guest.
 *
 * An email address and nothing else. No password, no confirmation link, no
 * account. That is the whole premise: the friend you asked for notes will
 * click a link and type an address, and will not create an account, so any
 * design that requires one collects no feedback.
 *
 * The address is unverified and is never treated as proof of anything. The
 * capability is the share link, which the caller must already hold to reach
 * this route at all; the address only labels which column of comments is
 * theirs. Anyone claiming to be someone else here gains nothing they did not
 * already have by holding the link, and still cannot read another reviewer's
 * comments, because those are partitioned by a token we mint.
 */

const IDENTIFY_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Sharing is not available on this build." }, { status: 503 });
  }

  const refused = guardJsonMutation(req);
  if (refused) return refused;

  // Public and unauthenticated, so the per-IP cap is the only backstop.
  const limit = checkRateLimit(`share-identify:${getClientIp(req)}`, IDENTIFY_RATE_LIMIT);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);

  const { token } = await ctx.params;
  const share = await findShareByToken(token);
  if (!share) return NextResponse.json({ error: "This link is no longer active." }, { status: 404 });

  let body: { email?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (typeof body.email !== "string" || !looksLikeEmail(body.email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const { guest, token: guestToken } = await identifyGuest(
    share.id,
    body.email,
    typeof body.name === "string" ? body.name : undefined,
  );

  const res = NextResponse.json({ ok: true, name: guest.name, email: guest.email });
  res.cookies.set(guestCookieName(share.id), guestToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.SESSION_COOKIE_SECURE !== "false",
    path: "/",
    // Outlives any reasonable review cycle without being permanent.
    maxAge: 90 * 24 * 60 * 60,
  });
  return res;
}
