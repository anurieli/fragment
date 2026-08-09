"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ContentPiece, Priority } from "@/lib/content-engine";
import { useContentStore } from "@/stores/content-store";
import { useToastStore } from "@/hooks/use-toast";
import { ContextMenuDivider, ContextMenuItem } from "@/components/common/context-menu";

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
];

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

  return (
    <>
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
