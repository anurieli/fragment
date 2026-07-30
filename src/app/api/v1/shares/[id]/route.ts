import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";
import { guardJsonMutation, isCrossSite, crossSiteRefused } from "@/lib/server/csrf";
import { revokeShare, resnapshotShare } from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * One share.
 *
 *   PATCH  — refresh the frozen copy reviewers see, bumping the revision
 *   DELETE — revoke the link, keeping the feedback already collected
 *
 * Both take the share id from the path and the owner from the session, and
 * every underlying query is keyed on the pair. A share id belonging to
 * someone else is therefore indistinguishable from one that does not exist,
 * which is the correct answer to give.
 */

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "This Fragment build has no cloud configured." }, { status: 503 });
  }

  const refused = guardJsonMutation(req);
  if (refused) return refused;

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;

  let body: { markdown?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (typeof body.markdown !== "string" || !body.markdown.trim()) {
    return NextResponse.json({ error: "Nothing to share" }, { status: 400 });
  }

  const share = await resnapshotShare(id, user.id, body.markdown, body.title ?? "Untitled");
  if (!share) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    share: { id: share.id, title: share.title, revision: share.revision },
  });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "This Fragment build has no cloud configured." }, { status: 503 });
  }
  if (isCrossSite(req)) return crossSiteRefused();

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const revoked = await revokeShare(id, user.id);

  // Already-revoked and never-existed both answer 404: the caller learns
  // nothing about shares that are not theirs either way.
  if (!revoked) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
