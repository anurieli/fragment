"use client";

import { ArrowRight, Check, FileText, X } from "lucide-react";
import type { ContentPiece } from "@/lib/content-engine";
import { isLongformFormat } from "@/lib/content-engine";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useToastStore } from "@/hooks/use-toast";

interface PieceTriageBarProps {
  piece: ContentPiece;
  /** The feed's own delete-with-undo, reused so "Dismiss" behaves identically
   * to Backspace on a focused card. */
  onDismiss: () => void;
}

/**
 * The row of decisions that empties the inbox. An inbox is only useful if it
 * can reach zero, so every piece sitting in one gets three one-click exits:
 * pick it up, ship it, or drop it. Rendered only while status is "inbox":
 * once a piece has been triaged the row disappears and the card goes back to
 * being just the piece.
 *
 * A fourth, "Make it a draft", promotes the piece to a long-form format.
 * That is now the whole move: format is what decides which surface a piece
 * is edited on, so changing it hands the same text to the editor. An essay has
 * no business being written in a card wedged between two tweets.
 */
export function PieceTriageBar({ piece, onDismiss }: PieceTriageBarProps) {
  const setPieceStatus = useContentStore((s) => s.setPieceStatus);
  const acceptExtractedPiece = useContentStore((s) => s.acceptExtractedPiece);
  const updatePiece = useContentStore((s) => s.updatePiece);
  const setActivePiece = useAppStore((s) => s.setActivePiece);
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const showToast = useToastStore((s) => s.showToast);

  // Already long-form, so there is nothing to promote. A piece in that
  // shape belongs to the Write space and does not reach the feed at all.
  const longform = isLongformFormat(piece.format);

  if (piece.reviewQueue === "extraction") {
    return (
      <div className="flex items-center gap-1.5 mt-3 flex-wrap">
        <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)] mr-1">
          Review
        </span>
        <TriageButton
          icon={<Check size={11} />}
          label="Accept"
          title="Keep this and move it into active work"
          primary
          onClick={() => {
            acceptExtractedPiece(piece.id);
            showToast("Accepted into In progress");
          }}
        />
        <TriageButton
          icon={<X size={11} />}
          label="Toss"
          title="Not worth working on; removes it with an undo"
          destructive
          onClick={onDismiss}
        />
      </div>
    );
  }

  function handleMakeDraft() {
    const previousFormat = piece.format;
    const previousStatus = piece.status;
    updatePiece(piece.id, { format: "essay", status: "in-progress" });
    // Land the user in the draft: this action means "I'm writing this now".
    setActivePiece(piece.id);
    setIdeaSpace(piece.ideaId, "write");
    showToast("Now a draft. Write it in the editor.", {
      label: "Undo",
      onClick: () => {
        updatePiece(piece.id, { format: previousFormat, status: previousStatus });
        setIdeaSpace(piece.ideaId, "pieces");
      },
    });
  }

  return (
    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)] mr-1">
        Triage
      </span>

      {!longform && (
        <TriageButton
          icon={<FileText size={11} />}
          label="Make it a draft"
          title="Turn this into a long-form draft and open it in the editor"
          onClick={handleMakeDraft}
        />
      )}

      <TriageButton
        icon={<ArrowRight size={11} />}
        label="Work on it"
        title="Keep it: moves to In progress"
        primary
        onClick={() => {
          setPieceStatus(piece.id, "in-progress");
          showToast("Moved to In progress");
        }}
      />

      <TriageButton
        icon={<Check size={11} />}
        label="Ready to ship"
        title="Good as it stands — moves to Ready, the publish queue"
        onClick={() => {
          setPieceStatus(piece.id, "ready");
          showToast("Moved to Ready");
        }}
      />

      <TriageButton
        icon={<X size={11} />}
        label="Dismiss"
        title="Not worth working on — removes it, with an undo"
        destructive
        onClick={onDismiss}
      />
    </div>
  );
}

function TriageButton({
  icon,
  label,
  title,
  primary,
  destructive,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  primary?: boolean;
  destructive?: boolean;
  onClick: () => void;
}) {
  const tone = destructive
    ? "text-text-faint border-border hover:text-red hover:border-red/30 hover:bg-red-muted"
    : primary
      ? "text-gold border-gold/30 bg-gold/5 hover:bg-gold/10"
      : "text-text-muted border-border hover:text-text-secondary hover:bg-surface-2";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      title={title}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-default)] border text-[11px] transition-all duration-150 ${tone}`}
    >
      {icon}
      {label}
    </button>
  );
}
