import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { guardJsonMutation } from "@/lib/server/csrf";
import { checkRateLimit, rateLimitResponse, getClientIp, bodyTooLarge } from "@/lib/api-guards";
import {
  findShareByToken,
  findGuestByToken,
  submitReview,
  sanitizeComments,
  guestCookieName,
} from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * A reviewer sending their pass back to the author.
 *
 * The guest is identified by the cookie set at /identify, checked against
 * *this* share. A cookie minted for another draft does not authenticate here
 * (see `findGuestByToken`), which is what stops a stale cookie from filing
 * one person's comments under someone else's review.
 */

const SUBMIT_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;
const MAX_SUBMIT_BYTES = 2_000_000;

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "Sharing is not available on this build." }, { status: 503 });
  }

  const refused = guardJsonMutation(req);
  if (refused) return refused;

  if (bodyTooLarge(req, MAX_SUBMIT_BYTES)) {
    return NextResponse.json({ error: "That review is too large to send." }, { status: 413 });
  }

  const limit = checkRateLimit(`share-submit:${getClientIp(req)}`, SUBMIT_RATE_LIMIT);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);

  const { token } = await ctx.params;
  const share = await findShareByToken(token);
  if (!share) return NextResponse.json({ error: "This link is no longer active." }, { status: 404 });

  const guestToken = req.cookies.get(guestCookieName(share.id))?.value;
  const guest = guestToken ? await findGuestByToken(guestToken, share.id) : null;
  if (!guest) {
    // Tell the page to re-ask for the address rather than failing opaquely.
    return NextResponse.json({ error: "Tell us who you are first.", needsIdentity: true }, { status: 401 });
  }

  let body: {
    comments?: unknown;
    editedFullText?: unknown;
    reviewerName?: unknown;
    revision?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const comments = sanitizeComments(body.comments);

  // An edit is only accepted when the owner left editing on. A reviewer whose
  // permission was revoked mid-review keeps their comments and loses only the
  // rewrite, which is the smaller surprise.
  const editedFullText =
    share.allowEdits && typeof body.editedFullText === "string" && body.editedFullText.trim()
      ? body.editedFullText.slice(0, MAX_SUBMIT_BYTES)
      : undefined;

  const revision =
    typeof body.revision === "number" && Number.isFinite(body.revision)
      ? Math.max(1, Math.floor(body.revision))
      : share.revision;

  const { saved } = await submitReview({
    shareId: share.id,
    guestId: guest.id,
    revision,
    name: typeof body.reviewerName === "string" ? body.reviewerName : undefined,
    comments,
    editedFullText,
  });

  return NextResponse.json({ ok: true, saved });
}
