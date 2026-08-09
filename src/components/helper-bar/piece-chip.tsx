"use client";

import { useCallback, useRef, useState } from "react";
import { FileText } from "lucide-react";

import { useAppStore } from "@/stores/app-store";
import { markdownToPlainText } from "@/lib/publish";
import type { ContentPiece } from "@/lib/content-engine";

/**
 * One of the idea's other pieces, sitting in the right-hand bar while you
 * write, draggable into the draft.
 *
 * The bar already held the parts you cut out of a document. The pieces of the
 * same idea are parts too: the LinkedIn version, the paragraph an agent left
 * overnight, the thing you wrote last week and forgot. Keeping them a panel
 * switch away meant the draft could not see them, so the drag reads them in.
 *
 * Unlike a snip, a piece is copied rather than moved. It has a life of its own
 * in the feed, and pulling a line of it into a draft is not a decision to
 * destroy it, so the card stays where it is and `snippetId: null` tells the
 * editor there is nothing to consume.
 */

interface PieceChipProps {
  piece: ContentPiece;
}

/** Title if it has one, else the opening words, so a row is never blank. */
export function pieceChipLabel(piece: Pick<ContentPiece, "title" | "body">): string {
  const title = piece.title?.trim();
  if (title) return title;
  const firstLine = markdownToPlainText(piece.body)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine || "Empty";
}

export function PieceChip({ piece }: PieceChipProps) {
  const setDraggingToEditor = useAppStore((s) => s.setDraggingToEditor);
  const [isDragging, setIsDragging] = useState(false);
  const label = pieceChipLabel(piece);
  const preview = markdownToPlainText(piece.body).replace(/\s+/g, " ").trim();

  // Mouse-based drag rather than native DnD, matching SnippetCard: native drag
  // events do not fire reliably in Tauri's WKWebView.
  const startedRef = useRef(false);
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      startedRef.current = false;

      const onMove = (ev: MouseEvent) => {
        if (!startedRef.current) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
          startedRef.current = true;
          setIsDragging(true);
          setDraggingToEditor(true);
          document.body.style.userSelect = "none";
          useAppStore.getState().setFloatingDragCard({
            content: piece.body,
            label,
            labelStatus: "done",
          });
        }
        const card = document.querySelector("[data-floating-card]") as HTMLElement | null;
        if (card) {
          card.style.transform = `translate(${ev.clientX + 16}px, ${ev.clientY + 16}px)`;
          card.style.opacity = "1";
        }
      };

      const onUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (!startedRef.current) return;

        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const editorEl = document.querySelector(".tiptap-editor");
        if (editorEl && editorEl.contains(target) && piece.body.trim()) {
          useAppStore.getState().setPendingSnippetInsert({
            snippetId: null,
            content: piece.body,
            clientX: ev.clientX,
            clientY: ev.clientY,
          });
        }

        document.body.style.userSelect = "";
        setIsDragging(false);
        setDraggingToEditor(false);
        useAppStore.getState().setFloatingDragCard(null);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [piece.body, label, setDraggingToEditor],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      title={`Drag into the draft to bring its text in. ${label}`}
      className={`group rounded-[var(--radius-default)] bg-surface-3 border border-border
        hover:bg-surface-hover hover:border-border-active cursor-grab active:cursor-grabbing
        transition-all duration-150 px-3 py-2.5 ${isDragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-start gap-2">
        <FileText size={12} className="text-text-faint mt-0.5 shrink-0" />
        <div className="min-w-0">
          <div className="text-[12px] font-medium text-text-secondary truncate">{label}</div>
          {preview && (
            <div className="text-[11px] text-text-faint line-clamp-2 leading-snug mt-0.5">
              {preview}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
