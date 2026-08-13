"use client";

import { useState } from "react";
import type { ContentPiece } from "@/lib/content-engine";
import { publishPendingState } from "@/lib/publish";
import { MarkPublishedForm } from "./mark-published-form";

interface PublishPendingPromptProps {
  piece: ContentPiece;
  /** Passed in rather than read from a clock here, so a feed of cards shares one tick. */
  now: number;
}

/**
 * The badge a piece wears between "I pressed publish" and "it is live", turned
 * into the place you finish the job.
 *
 * Publishing to somewhere without an API (Substack articles and Notes, an X
 * intent) finishes in another tab, so Fragment cannot see it happen. It used to
 * guess: poll the author's Substack RSS feed and fuzzy-match titles. That works
 * for articles and silently never fires for anything else, because Notes are not
 * in the feed at all.
 *
 * Asking for the link is a fact instead of an inference, it works for every
 * destination, and it yields the canonical URL immediately. So this badge opens
 * a paste field. The RSS loop still runs and still resolves the badge on its own
 * when it can (see use-publish-verification.ts); this is the path that does not
 * depend on it.
 */
export function PublishPendingPrompt({ piece, now }: PublishPendingPromptProps) {
  const [open, setOpen] = useState(false);
  const pending = publishPendingState(piece.publishAttemptedAt, now);

  if (pending === "none") return null;

  // After 24h the wording stops assuming this is still in flight. Same
  // threshold the badge has always used, now attached to an action.
  const label = pending === "nudge" ? "did this go live?" : "paste the link";
  const title =
    pending === "nudge"
      ? "Published over 24h ago and still unconfirmed. Paste the link to close it out."
      : "Published it? Paste the link and Fragment will record where it went.";

  return (
    <span className="relative inline-flex">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title={title}
        className={`text-[10px] px-1.5 py-0.5 rounded-[4px] border transition-colors duration-150 ${
          pending === "nudge"
            ? "text-gold border-gold/40 bg-gold/10 hover:bg-gold/20"
            : "text-text-faint border-border bg-surface-2 hover:text-text-secondary hover:bg-surface-hover"
        }`}
      >
        {label}
      </button>

      {open && (
        <span
          className="absolute left-0 top-full mt-1 z-30 w-60 block bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl"
          style={{ animation: "fadeIn 0.12s ease-out" }}
        >
          <MarkPublishedForm piece={piece} onDone={() => setOpen(false)} />
        </span>
      )}
    </span>
  );
}
