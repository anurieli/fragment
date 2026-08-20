"use client";

import { useState } from "react";
import type { ContentPiece } from "@/lib/content-engine";
import { useContentStore } from "@/stores/content-store";
import { useToastStore } from "@/hooks/use-toast";

interface MarkPublishedFormProps {
  piece: ContentPiece;
  /** Called after a confirm, so the host menu can close itself. */
  onDone: () => void;
  /** Set by the dialog, whose only reason to exist is this field. */
  autoFocus?: boolean;
}

/**
 * The manual "this is live, here is the link" escape hatch, shared by the feed
 * card's Share menu and the editor's publish menu.
 *
 * It lived only in the feed's menu, which meant a draft (which opens in the
 * editor, not the feed) had no way to be marked published at all. That was the
 * gap behind "I published this draft, where do I say so?". A piece is a piece
 * whichever surface edits it, so the action belongs to both.
 *
 * A URL is optional but it is what makes the record verified: `verified` tracks
 * "we can point at this" rather than "we checked it", which is the same meaning
 * the Substack RSS loop gives it when it matches a feed entry.
 */
export function MarkPublishedForm({ piece, onDone, autoFocus }: MarkPublishedFormProps) {
  const [url, setUrl] = useState("");
  const setPieceStatus = useContentStore((s) => s.setPieceStatus);
  const showToast = useToastStore((s) => s.showToast);

  function handleConfirm() {
    const trimmed = url.trim();
    setPieceStatus(piece.id, "published", {
      platform: piece.format,
      method: "manual",
      publishedAt: Date.now(),
      url: trimmed || undefined,
      verified: Boolean(trimmed),
    });
    showToast(trimmed ? "Marked published." : "Marked published, with no URL on file.");
    setUrl("");
    onDone();
  }

  return (
    <div className="px-3 pb-2 pt-1 space-y-1.5" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        autoFocus={autoFocus}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleConfirm();
          }
        }}
        placeholder="Published URL (optional)"
        className="w-full bg-surface-2 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-text-primary placeholder:text-text-faint outline-none focus:border-border-active"
      />
      <p className="text-[10px] text-text-faint leading-snug">
        Marks this piece published now, without waiting for verification.
      </p>
      <button
        onClick={handleConfirm}
        className="w-full px-2 py-1 rounded-[var(--radius-sm)] text-[11px] text-text-primary bg-surface-2 hover:bg-surface-hover transition-colors duration-150"
      >
        Confirm
      </button>
    </div>
  );
}
