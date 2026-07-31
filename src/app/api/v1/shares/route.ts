import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";
import { guardJsonMutation } from "@/lib/server/csrf";
import { checkRateLimit, rateLimitResponse, bodyTooLarge } from "@/lib/api-guards";
import { createShare, listSharesForUser, listCommentCountsForUser, inviteGuests } from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * The owner's end of sharing a draft.
 *
 *   POST — mint a share link for a note, optionally pre-inviting reviewers
 *   GET  — list this user's shares, optionally filtered to one note
 *
 * Both are session-scoped. There is no route here that takes a user id from
 * the caller; ownership always comes from the cookie.
 */

/** A whole draft, generously. Larger than this is not a draft, it is a book. */
const MAX_SHARE_BODY_BYTES = 2_000_000;

/** Minting links is cheap for us and the main lever an abuser would pull. */
const SHARE_RATE_LIMIT = { limit: 30, windowMs: 60_000 } as const;

/** One share, one sensible dinner party. Keeps a bulk-mail vector closed. */
const MAX_INVITES = 25;

function cloudUnavailable() {
  return NextResponse.json(
    { error: "This Fragment build has no cloud configured." },
    { status: 503 },
  );
}

export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) return cloudUnavailable();

  const refused = guardJsonMutation(req);
  if (refused) return refused;

  if (bodyTooLarge(req, MAX_SHARE_BODY_BYTES)) {
    return NextResponse.json({ error: "Draft too large to share." }, { status: 413 });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const limit = checkRateLimit(`shares:${user.id}`, SHARE_RATE_LIMIT);
  if (!limit.ok) return rateLimitResponse(limit.retryAfter);

  let body: {
    noteId?: string;
    title?: string;
    markdown?: string;
    allowEdits?: boolean;
    invite?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (!body.noteId || typeof body.noteId !== "string") {
    return NextResponse.json({ error: "Missing noteId" }, { status: 400 });
  }
  if (typeof body.markdown !== "string" || !body.markdown.trim()) {
    return NextResponse.json({ error: "Nothing to share" }, { status: 400 });
  }

  const { share, token } = await createShare({
    userId: user.id,
    noteId: body.noteId,
    title: typeof body.title === "string" ? body.title : "Untitled",
    markdown: body.markdown,
    allowEdits: body.allowEdits,
  });

  // Invitations return one token per address. Sending the emails is the
  // caller's job for now: with no mail provider configured the honest thing
  // is to hand back per-person links the owner can paste, rather than
  // silently accept an invite that never arrives.
  const invited =
    Array.isArray(body.invite) && body.invite.length > 0
      ? await inviteGuests(share.id, user.id, body.invite.slice(0, MAX_INVITES))
      : [];

  return NextResponse.json({
    share: {
      id: share.id,
      noteId: share.noteId,
      title: share.title,
      revision: share.revision,
      allowEdits: share.allowEdits,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
    },
    // The only time the plaintext token exists. It is not stored and cannot
    // be re-read; losing it means minting a new link.
    token,
    invited,
  });
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured()) return cloudUnavailable();

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const noteId = req.nextUrl.searchParams.get("noteId") ?? undefined;
  const [shares, counts] = await Promise.all([
    listSharesForUser(user.id, noteId),
    listCommentCountsForUser(user.id, noteId),
  ]);
  const countByShare = new Map(counts.map((c) => [c.shareId, c]));

  return NextResponse.json({
    shares: shares.map((s) => ({
      id: s.id,
      noteId: s.noteId,
      title: s.title,
      revision: s.revision,
      allowEdits: s.allowEdits,
      createdAt: s.createdAt,
      revokedAt: s.revokedAt,
      expiresAt: s.expiresAt,
      commentCount: countByShare.get(s.id)?.commentCount ?? 0,
      lastCommentAt: countByShare.get(s.id)?.lastCommentAt ?? null,
    })),
  });
}
