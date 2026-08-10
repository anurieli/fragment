import type { ContentPiece } from "@/lib/content-engine";
import type { ReviewReturn } from "@/lib/types";
import { listShares, listReviews } from "./client";
import { shareKeyFor } from "./share-key";

/**
 * Pull whatever reviewers have left on a fragment's hosted share links into
 * local storage. Shared between the export menu's manual "Check for
 * comments" and the toolbar's "View comments" affordance (ARI-245), so both
 * ways in land the same reviews the same way rather than drifting apart.
 *
 * Takes the fragment rather than an id because the two sides of the trip are
 * keyed differently: links are listed under the share key, and what comes
 * back is stored against the fragment itself.
 */
export async function pullHostedReviews(
  piece: Pick<ContentPiece, "id" | "legacyNoteId">,
  saveHostedReview: (pieceId: string, guestId: string, review: ReviewReturn) => Promise<unknown>,
): Promise<{ imported: number; hasShares: boolean }> {
  const shares = await listShares(shareKeyFor(piece));
  const perShare = await Promise.all(shares.map((s) => listReviews(s.id).catch(() => [])));

  let imported = 0;
  for (const reviews of perShare) {
    for (const review of reviews) {
      if (review.comments.length === 0 && !review.editedFullText) continue;
      await saveHostedReview(piece.id, review.guestId, {
        docId: review.guestId,
        reviewerName: review.name?.trim() || review.email,
        reviewerEmail: review.email,
        timestamp: Date.parse(review.lastSeenAt ?? "") || Date.now(),
        comments: review.comments.map((c) => ({
          id: c.id,
          anchorText: c.anchorText,
          prefix: c.prefix,
          suffix: c.suffix,
          body: c.body,
        })),
        editedFullText: review.editedFullText ?? undefined,
      });
      imported += 1;
    }
  }

  return { imported, hasShares: shares.length > 0 };
}
