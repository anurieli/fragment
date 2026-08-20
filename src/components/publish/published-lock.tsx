"use client";

import { Lock } from "lucide-react";
import type { ContentPiece } from "@/lib/content-engine";
import { formatDate } from "@/lib/utils";
import { PublishReceipt } from "./publish-receipt";

/**
 * Whether a piece's text is closed to editing.
 *
 * Publishing closes it. What shipped is a fact, and quietly rewriting it makes
 * the publish record a claim about text that no longer exists. `unlocked` is the
 * host surface's transient "Edit anyway" state, deliberately not persisted: the
 * lock should come back the next time the piece is opened, because the reason
 * for it has not gone away.
 */
export function isPieceLocked(piece: ContentPiece, unlocked: boolean): boolean {
  return piece.status === "published" && !unlocked;
}

interface PublishedLockProps {
  piece: ContentPiece;
  /** Reopens the text. Transient, and owned by the host surface. */
  onEditAnyway: () => void;
  /** Makes an unpublished copy carrying the words and the brief. */
  onDuplicate: () => void;
  /** "banner" spans the editor; "inline" is the narrower feed card. */
  variant?: "banner" | "inline";
}

/**
 * The greyed-out "This is published" notice, shown wherever a published piece
 * can be read but not written: the top of the editor, and the feed card.
 *
 * Two ways forward, and they answer different questions. Duplicate is for when
 * the next version is a new piece. "Edit anyway" is for a typo, where making a
 * second piece would split one piece's history in half over a comma. Taking it
 * is recorded rather than hidden: the first change stamps
 * `editedAfterPublishAt` and this notice starts saying so.
 */
export function PublishedLock({
  piece,
  onEditAnyway,
  onDuplicate,
  variant = "banner",
}: PublishedLockProps) {
  const diverged = piece.editedAfterPublishAt !== undefined;
  const headline = diverged
    ? `Published, edited since ${formatDate(piece.editedAfterPublishAt!)}.`
    : "This is published.";
  const explanation = diverged
    ? "What is here no longer matches what went out."
    : "Its words are closed. Duplicate it to keep writing.";

  return (
    <div
      className={`flex items-center gap-3 rounded-[var(--radius-default)] border border-border bg-surface-2/60 ${
        variant === "banner" ? "px-4 py-2.5 mx-8 mb-3" : "px-3 py-2 mb-2"
      }`}
    >
      <Lock size={13} className="shrink-0 text-text-faint" />

      <div className="min-w-0 flex-1">
        <p className={`text-text-muted ${variant === "banner" ? "text-[12px]" : "text-[11px]"}`}>
          {headline}
          {variant === "banner" && (
            <span className="text-text-faint"> {explanation}</span>
          )}
        </p>
        {piece.publish && (
          <div className="mt-1">
            <PublishReceipt publish={piece.publish} />
          </div>
        )}
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDuplicate();
        }}
        title="Make an unpublished copy of this piece, with its brief, in the same idea"
        className="shrink-0 px-2 py-1 rounded-[var(--radius-sm)] text-[11px] text-text-secondary bg-surface-3 hover:bg-surface-hover hover:text-text-primary transition-colors duration-150"
      >
        Duplicate
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onEditAnyway();
        }}
        title="Reopen the text. Fragment will record that this piece no longer matches what was published."
        className="shrink-0 px-2 py-1 rounded-[var(--radius-sm)] text-[11px] text-text-faint hover:text-text-secondary transition-colors duration-150"
      >
        Edit anyway
      </button>
    </div>
  );
}
