import { isLongformFormat } from "@/lib/content-engine";
import type { ContentFormat, ContentPiece, PieceStatus } from "@/lib/content-engine";

/**
 * The two lists the idea panel shows: long-form Drafts, short-form Pieces.
 * Not a stored field. Which list a fragment appears in is read off its format
 * every time, so there is nothing that can disagree with it.
 */
export type PanelSection = "drafts" | "pieces";

/**
 * The format a fragment takes on when it is dragged into Drafts. "essay" is
 * the neutral long-form shape, and the one `handleNewDraft` already hands to a
 * draft started by hand.
 */
export const DRAFT_FORMAT: ContentFormat = "essay";

/**
 * The format a fragment takes on when it is dragged into Pieces. "other" is
 * the short-form shape that claims no platform: a fragment that lands in the
 * feed has not yet decided whether it is a tweet or a LinkedIn post.
 */
export const PIECE_FORMAT: ContentFormat = "other";

/** Which of the two lists this fragment currently belongs to. */
export function sectionOf(piece: Pick<ContentPiece, "format">): PanelSection {
  return isLongformFormat(piece.format) ? "drafts" : "pieces";
}

/**
 * What has to change on a fragment for it to live in `to`, or null if it is
 * already there — so a drop onto the list something came from is a no-op
 * rather than a pointless write that bumps `updatedAt` and re-sorts the feed.
 *
 * Moving between the lists changes the fragment's *shape* and nothing else.
 * Every fragment stores its text the same way (`body`), and format alone
 * decides which surface edits it, so this never touches a byte of the writing
 * (see LONGFORM_FORMATS in the content-engine contract).
 *
 * Status travels in one direction only. "inbox" means nobody has looked at
 * this yet; dragging it into Drafts *is* looking at it, so it stops waiting
 * for a decision it has now had. Nothing about the other direction says a
 * draft is finished with, so its status is left exactly as it was.
 *
 * The one thing a round trip does lose is a short-form fragment's platform: a
 * "linkedin" piece dragged into Drafts and back comes home as "other", because
 * a draft has nowhere to keep the answer. Undo restores it exactly; a second
 * trip does not.
 */
export function moveToSection(
  piece: Pick<ContentPiece, "format" | "status">,
  to: PanelSection,
): { format: ContentFormat; status?: PieceStatus } | null {
  if (sectionOf(piece) === to) return null;
  if (to === "drafts") {
    return piece.status === "inbox"
      ? { format: DRAFT_FORMAT, status: "in-progress" }
      : { format: DRAFT_FORMAT };
  }
  return { format: PIECE_FORMAT };
}
