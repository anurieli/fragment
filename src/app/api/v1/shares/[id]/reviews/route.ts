import { NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";
import { listReviewsForOwner } from "@/lib/server/shares";

export const runtime = "nodejs";

/**
 * Everything every reviewer said about one share.
 *
 * This is the single route in the sharing feature that returns more than one
 * person's comments, and it is owner-only: `listReviewsForOwner` resolves the
 * share by (id, user_id) and returns null when that pair does not match, so
 * there is no argument a guest could supply that reaches another reviewer's
 * feedback through here. Guests read their own comments from the review page
 * itself, which is served with only their rows.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "This Fragment build has no cloud configured." }, { status: 503 });
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { id } = await ctx.params;
  const reviews = await listReviewsForOwner(id, user.id);
  if (!reviews) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ reviews });
}
