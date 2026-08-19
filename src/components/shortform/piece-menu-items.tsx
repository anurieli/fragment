"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ContentPiece } from "@/lib/content-engine";
import { isLongformFormat } from "@/lib/content-engine";
import { useContentStore } from "@/stores/content-store";
import { useAppStore } from "@/stores/app-store";
import { moveToSection } from "@/lib/piece-section";
import { PRIORITY_OPTIONS } from "@/lib/priority";
import { titleFromText } from "@/lib/derive-title";
import { useToastStore } from "@/hooks/use-toast";
import { ContextMenuDivider, ContextMenuItem } from "@/components/common/context-menu";

interface PieceMenuItemsProps {
  piece: ContentPiece;
  onClose: () => void;
  onDelete: () => void;
  /** Omitted where Flow has nowhere to write (the idea panel's rows are a
   * table of contents, not an editor). */
  onWriteWithFlow?: () => void;
  flowDisabledReason?: string;
  /** Omitted where there's no anchor for the popover to hang off. */
  onOpenResources?: () => void;
  /** Omitted where the surface has nowhere to put a name. A feed card shows
   * the writing itself and has no title line; the idea panel's rows are
   * labels, so renaming is the whole of what they can be edited for. */
  onRename?: () => void;
}

/**
 * Every action a piece has, in one list, so the ⋯ button in the feed's footer
 * and the right-click menu on any row offer exactly the same thing. Two menus
 * that drift apart are how a writer learns to distrust both.
 *
 * Delete stays the caller's job: the feed has to pick what to look at next
 * and the panel has to keep the editor pointed somewhere, and neither answer
 * belongs in a menu.
 */
export function PieceMenuItems({
  piece,
  onClose,
  onDelete,
  onWriteWithFlow,
  flowDisabledReason,
  onOpenResources,
  onRename,
}: PieceMenuItemsProps) {
  const setPiecePriority = useContentStore((s) => s.setPiecePriority);
  const pinPiece = useContentStore((s) => s.pinPiece);
  const unpinPiece = useContentStore((s) => s.unpinPiece);
  const archivePiece = useContentStore((s) => s.archivePiece);
  const unarchivePiece = useContentStore((s) => s.unarchivePiece);
  const showToast = useToastStore((s) => s.showToast);
  const [priorityOpen, setPriorityOpen] = useState(false);

  const isPinned = piece.pinnedAt !== undefined;
  const isArchived = piece.archivedAt !== undefined;

  if (piece.reviewQueue === "extraction") {
    return (
      <ContextMenuItem
        label="Toss"
        destructive
        onClick={() => { onClose(); onDelete(); }}
      />
    );
  }

  return (
    <>
      {onRename && (
        <ContextMenuItem
          label="Rename"
          hint="Double-clicking the row does this too"
          onClick={() => { onClose(); onRename(); }}
        />
      )}

      {onOpenResources && (
        <ContextMenuItem
          label="Resources"
          title="Reference links and assets for this piece, including the ones inherited from its idea"
          onClick={() => { onClose(); onOpenResources(); }}
        />
      )}

      <ContextMenuItem
        label={isPinned ? "Unpin" : "Pin to the top"}
        hint={isPinned ? undefined : "Holds it above the feed in every sort but Manual"}
        onClick={() => {
          if (isPinned) unpinPiece(piece.id);
          else pinPiece(piece.id);
          onClose();
        }}
      />

      <button
        role="menuitem"
        onClick={(e) => { e.stopPropagation(); setPriorityOpen((v) => !v); }}
        className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
      >
        Set priority
        <ChevronDown size={10} />
      </button>
      {priorityOpen && (
        <div className="border-t border-border py-1">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={(e) => {
                e.stopPropagation();
                setPiecePriority(piece.id, opt.value);
                onClose();
              }}
              className="block w-full text-left px-4 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      <PieceShapeItems piece={piece} onClose={onClose} />

      {onWriteWithFlow && (
        <ContextMenuItem
          label="Write with Flow..."
          disabled={Boolean(flowDisabledReason)}
          title={flowDisabledReason ?? "Ask Flow to write into this piece (⌘⏎, or / at the start of a line)"}
          onClick={() => { onClose(); onWriteWithFlow(); }}
        />
      )}

      <ContextMenuDivider />

      <ContextMenuItem
        label={isArchived ? "Take out of the archive" : "Archive"}
        hint={isArchived ? undefined : "Hidden from the feed. Nothing is deleted"}
        onClick={() => {
          onClose();
          if (isArchived) {
            unarchivePiece(piece.id);
            showToast("Back in the feed.");
            return;
          }
          archivePiece(piece.id);
          showToast("Piece archived", {
            label: "Undo",
            onClick: () => unarchivePiece(piece.id),
          });
        }}
      />

      <ContextMenuItem
        label="Delete"
        destructive
        onClick={() => { onClose(); onDelete(); }}
      />
    </>
  );
}

/**
 * The two moves that change what a piece *is* rather than what it says: its
 * shape (a draft or a card in the feed) and its home (an idea of its own).
 *
 * Both are a single write and both are reversible, which is why they sit in
 * the ordinary menu next to pin and priority instead of behind a confirmation.
 * Format is shape and nothing else — a piece holds its text the same way
 * either way — so turning one into a draft moves it between surfaces without
 * touching a byte of it.
 *
 * Exported on its own because the idea panel's draft rows have their own
 * short menu rather than the full piece list, and the same two moves have to
 * read identically there.
 */
export function PieceShapeItems({
  piece,
  onClose,
}: {
  piece: ContentPiece;
  onClose: () => void;
}) {
  const updatePiece = useContentStore((s) => s.updatePiece);
  const createIdea = useContentStore((s) => s.createIdea);
  const deleteIdea = useContentStore((s) => s.deleteIdea);
  const showToast = useToastStore((s) => s.showToast);

  const isDraft = isLongformFormat(piece.format);

  if (piece.reviewQueue === "extraction") return null;

  /** Put the writer in front of the piece in whichever surface now owns it. */
  function show(shape: "draft" | "piece", pieceId: string, ideaId: string) {
    const app = useAppStore.getState();
    app.setActiveIdea(ideaId);
    if (shape === "draft") {
      app.setActivePiece(pieceId);
      app.setIdeaSpace(ideaId, "write");
      return;
    }
    app.setIdeaSpace(ideaId, "pieces");
    app.revealPiece(pieceId);
  }

  function changeShape() {
    // The rule itself lives in lib/piece-section.ts, because dragging a row
    // between the idea panel's two lists is this same move made with the
    // mouse. One of them silently triaging an inbox piece while the other
    // didn't would be a difference nobody could see and everybody would hit.
    const change = moveToSection(piece, isDraft ? "pieces" : "drafts");
    if (!change) return;
    const previous = { format: piece.format, status: piece.status };

    updatePiece(piece.id, change);
    show(isDraft ? "piece" : "draft", piece.id, piece.ideaId);
    showToast(isDraft ? "Now a piece. It lives in the feed." : "Now a draft. It opens in the editor.", {
      label: "Undo",
      onClick: () => {
        updatePiece(piece.id, previous);
        show(isDraft ? "draft" : "piece", piece.id, piece.ideaId);
      },
    });
  }

  function promoteToIdea() {
    const content = useContentStore.getState();
    const home = content.ideas[piece.ideaId];
    if (!home) return;

    const title = titleFromText(piece.title?.trim() || piece.body) || "Untitled idea";
    // Ideas nest one level deep, so a piece promoted out of a root idea
    // becomes its child and one promoted out of a child becomes that child's
    // sibling. Either way it stays in the family it came from, which is why
    // the parent's rolled-up feed still shows it afterwards.
    const parentId = home.parentId === null ? home.id : home.parentId;
    const newIdeaId = createIdea({ title, parentId, origin: "user" });
    if (!newIdeaId) return;

    const previousIdeaId = piece.ideaId;
    updatePiece(piece.id, { ideaId: newIdeaId });
    // Go there: the piece has left the list you were looking at, and an
    // editor left pointing at a piece that now lives elsewhere is the bug
    // this avoids.
    show(isDraft ? "draft" : "piece", piece.id, newIdeaId);

    showToast(`Idea created: ${title}`, {
      label: "Undo",
      onClick: () => {
        updatePiece(piece.id, { ideaId: previousIdeaId });
        // The new idea is empty again once the piece is back, so this takes
        // nothing with it.
        deleteIdea(newIdeaId);
        show(isDraft ? "draft" : "piece", piece.id, previousIdeaId);
      },
    });
  }

  return (
    <>
      <ContextMenuItem
        label={isDraft ? "Turn into a piece" : "Turn into a draft"}
        hint={isDraft ? "Moves it into the feed" : "Opens it in the long-form editor"}
        onClick={() => { onClose(); changeShape(); }}
      />
      <ContextMenuItem
        label="Turn into an idea"
        hint="Gives it an idea of its own to live in"
        onClick={() => { onClose(); promoteToIdea(); }}
      />
    </>
  );
}
