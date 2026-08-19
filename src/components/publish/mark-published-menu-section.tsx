"use client";

import type { ContentPiece } from "@/lib/content-engine";
import { ContextMenuItem } from "@/components/common/context-menu";
import { PublishReceipt } from "./publish-receipt";

/**
 * The publish state of one piece, as a section of whatever row menu is open on
 * it.
 *
 * A published piece shows where it went. An unpublished one gets the manual
 * "this is live, here is the link" action, because most destinations have no
 * API to ask and the writer is the only one who knows. Both belong wherever a
 * piece is listed, not only in the surface that happens to edit it: a draft
 * you posted to Substack is a published piece, and the idea panel is where you
 * are looking when you want to say so.
 *
 * The link is asked for in a dialog rather than here. A menu pinned to a point
 * closes on any scroll, and focusing a field inside it is enough to scroll it.
 */
export function MarkPublishedMenuSection({
  piece,
  onMark,
}: {
  piece: ContentPiece;
  /** Open the dialog. The host closes its own menu first. */
  onMark: () => void;
}) {
  if (piece.publish) {
    return (
      <div className="px-3 py-1.5">
        <PublishReceipt publish={piece.publish} variant="line" />
      </div>
    );
  }

  return (
    <ContextMenuItem
      label="Mark as published"
      hint="For anywhere without an API. Paste the link and this piece is closed"
      onClick={onMark}
    />
  );
}
