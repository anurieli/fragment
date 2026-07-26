"use client";

import { useCallback } from "react";
import { ArrowRight, Check, FileText, X } from "lucide-react";
import type { ContentPiece } from "@/lib/content-engine";
import { isLongformFormat } from "@/lib/content-engine";
import { markdownToPlainText } from "@/lib/publish";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";
import { useToastStore } from "@/hooks/use-toast";

interface PieceTriageBarProps {
  piece: ContentPiece;
  /** The feed's own delete-with-undo, reused so "Dismiss" behaves identically
   * to Backspace on a focused card. */
  onDismiss: () => void;
}

/** A note needs a name. Use the piece's title, else its first line of prose. */
function draftTitleFor(piece: ContentPiece): string {
  if (piece.title?.trim()) return piece.title.trim();
  const firstLine = markdownToPlainText(piece.body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return "Untitled draft";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77)}…` : firstLine;
}

/**
 * The row of decisions that empties the inbox. An inbox is only useful if it
 * can reach zero, so every piece sitting in one gets three one-click exits:
 * pick it up, ship it, or drop it. Rendered only while status is "inbox" —
 * once a piece has been triaged the row disappears and the card goes back to
 * being just the piece.
 *
 * Long-form formats (essay, substack, script) get a fourth, and their primary:
 * "Make it a draft" moves the text into a Note and opens the editor. An essay
 * has no business being edited in a card wedged between two tweets.
 */
export function PieceTriageBar({ piece, onDismiss }: PieceTriageBarProps) {
  const setPieceStatus = useContentStore((s) => s.setPieceStatus);
  const convertPieceToDraft = useContentStore((s) => s.convertPieceToDraft);
  const revertPieceToShortform = useContentStore((s) => s.revertPieceToShortform);
  const createNote = useDataStore((s) => s.createNote);
  const deleteNote = useDataStore((s) => s.deleteNote);
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const showToast = useToastStore((s) => s.showToast);

  const longform = isLongformFormat(piece.format);

  const handleMakeDraft = useCallback(() => {
    const noteId = createNote({ title: draftTitleFor(piece), content: piece.body ?? "" });
    if (!noteId) return;
    const previousBody = convertPieceToDraft(piece.id, noteId);
    if (previousBody === null) {
      deleteNote(noteId);
      return;
    }
    // Land the user in the draft: this action means "I'm writing this now".
    setActiveNote(noteId);
    setIdeaSpace(piece.ideaId, "write");
    showToast("Now a draft — write it in the editor", {
      label: "Undo",
      onClick: () => {
        // Revert first: deleteNote tombstones pieces that link the note.
        revertPieceToShortform(piece.id, previousBody, "inbox");
        deleteNote(noteId);
        setIdeaSpace(piece.ideaId, "pieces");
      },
    });
  }, [
    piece,
    createNote,
    convertPieceToDraft,
    revertPieceToShortform,
    deleteNote,
    setActiveNote,
    setIdeaSpace,
    showToast,
  ]);

  return (
    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
      <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)] mr-1">
        Triage
      </span>

      {longform && (
        <TriageButton
          icon={<FileText size={11} />}
          label="Make it a draft"
          title="Move this text into a note in this idea and open the editor"
          primary
          onClick={handleMakeDraft}
        />
      )}

      <TriageButton
        icon={<ArrowRight size={11} />}
        label="Work on it"
        title="Keep it — moves to In progress"
        primary={!longform}
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
