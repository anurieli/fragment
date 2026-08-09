import type { ContentPiece } from "@/lib/content-engine";

/**
 * The id shares and reviews are filed under for a fragment.
 *
 * A migrated fragment keeps filing under the note id it came from, and that is
 * deliberate rather than a leftover. Two things outlive the switchover: share
 * links already sitting in a reviewer's inbox, which resolve a row in
 * `shares` by its `note_id`, and the review threads that came back against
 * those same links. Re-keying them would mean a SQL migration on a NOT NULL
 * column plus a rewrite of every link that has already left the building, and
 * the second of those is not possible at all. So the key stays put, and only
 * the thing it points at changed shape.
 *
 * A fragment created after the switchover has no old id to honour, so it files
 * under its own.
 */
export function shareKeyFor(piece: Pick<ContentPiece, "id" | "legacyNoteId">): string {
  return piece.legacyNoteId ?? piece.id;
}
