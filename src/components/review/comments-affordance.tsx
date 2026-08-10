"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { Editor } from "@tiptap/react";
import { useContentStore } from "@/stores/content-store";
import { useReviewStore } from "@/stores/review-store";
import { useIncomingComments } from "@/hooks/use-incoming-comments";
import { pullHostedReviews } from "@/lib/sharing/pull-reviews";
import { shareKeyFor } from "@/lib/sharing/share-key";
import { ReviewPanel } from "./review-panel";
import { isHosted } from "@/lib/edition";

interface CommentsAffordanceProps {
  pieceId: string;
  editor: Editor;
}

/**
 * The persistent "View comments" affordance from ARI-245: a place at the top
 * of the draft, visible once it has ever collected a hosted-share comment,
 * badging what arrived since this browser last looked. Opens the same
 * ReviewPanel the export menu's "View reviews" does — this only decides
 * when to surface it and pulls fresh comments first.
 */
export function CommentsAffordance({ pieceId, editor }: CommentsAffordanceProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const piece = useContentStore((s) => s.pieces[pieceId]);
  const saveHostedReview = useReviewStore((s) => s.saveHostedReview);
  const hosted = isHosted();
  // The share key, not the fragment id: it is what the links were minted
  // under, and it is also what the seen-count is remembered against, so a
  // migrated fragment keeps the badge state it had before the switchover.
  const { totalCount, unreadCount, markSeen } = useIncomingComments(
    hosted && piece ? shareKeyFor(piece) : null,
  );

  if (!hosted || !piece || totalCount === 0) return null;

  async function open() {
    setPanelOpen(true);
    markSeen();
    try {
      await pullHostedReviews(piece, saveHostedReview);
    } catch {
      // Panel still opens with whatever was already imported locally.
    }
  }

  return (
    <>
      <button
        onClick={open}
        className="flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-[var(--radius-default)] text-[12px] text-text-secondary hover:text-text-primary hover:bg-surface-2 transition-all duration-150 shrink-0"
        title="See comments reviewers have left"
      >
        <MessageSquare size={14} className={unreadCount > 0 ? "text-gold" : "text-text-muted"} />
        <span className="hidden sm:inline">View comments</span>
        {unreadCount > 0 && (
          <span className="min-w-[16px] h-[16px] px-1 rounded-full bg-gold text-[10px] font-semibold text-[#1a1608] flex items-center justify-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {panelOpen && (
        <ReviewPanel pieceId={pieceId} editor={editor} onClose={() => setPanelOpen(false)} />
      )}
    </>
  );
}
