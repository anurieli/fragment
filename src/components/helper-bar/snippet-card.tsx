"use client";

import { useCallback, useRef, useState } from "react";
import { X, Loader2, AlertCircle, GripVertical, RotateCcw, FileInput, Copy, Tags, Trash2 } from "lucide-react";
import type { Snippet } from "@/lib/types";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useSnipLabeler } from "@/hooks/use-snip-labeler";
import { visibleSnippets } from "@/lib/snip-scope";
import { formatSnippetPreview } from "@/lib/utils";
import { useToastStore } from "@/hooks/use-toast";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  type Point,
} from "@/components/ui/context-menu";

interface SnippetCardProps {
  snippet: Snippet;
}

export function SnippetCard({ snippet }: SnippetCardProps) {
  const removeSnippet = useDataStore((s) => s.removeSnippet);
  const updateSnippetLabel = useDataStore((s) => s.updateSnippetLabel);
  const setDraggingToEditor = useAppStore((s) => s.setDraggingToEditor);
  const labelSnip = useSnipLabeler();
  const [showHover, setShowHover] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [contextMenuPosition, setContextMenuPosition] = useState<Point | null>(null);
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const preview = formatSnippetPreview(snippet.content);
  const isLong =
    snippet.content.split("\n").length > 6 || snippet.content.length > 200;

  const handleRetryLabel = useCallback(() => {
    updateSnippetLabel(snippet.id, null, "loading");
    labelSnip(snippet.id, snippet.content, { pieceId: snippet.pieceId ?? null, ideaId: snippet.ideaId });
  }, [snippet, updateSnippetLabel, labelSnip]);

  const handleInsertIntoEditor = useCallback(() => {
    setContextMenuPosition(null);
    const app = useAppStore.getState();
    if (!app.activePieceId) {
      useToastStore.getState().showToast("Open or create a draft before inserting a snippet.");
      return;
    }
    app.setPendingSnippetInsert({
      snippetId: snippet.id,
      content: snippet.content,
    });
    if (app.activeIdeaId) app.setIdeaSpace(app.activeIdeaId, "write");
  }, [snippet]);

  const handleCopyText = useCallback(async () => {
    setContextMenuPosition(null);
    try {
      await navigator.clipboard.writeText(snippet.content);
      useToastStore.getState().showToast("Snippet copied.");
    } catch {
      useToastStore.getState().showToast("Couldn't copy the snippet.");
    }
  }, [snippet.content]);

  const handleRelabel = useCallback(() => {
    setContextMenuPosition(null);
    handleRetryLabel();
  }, [handleRetryLabel]);

  const handleDeleteFromMenu = useCallback(() => {
    setContextMenuPosition(null);
    removeSnippet(snippet.id);
  }, [removeSnippet, snippet.id]);

  // Custom mouse-based drag (replaces native DnD which fails in Tauri/WKWebView)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Don't start drag from delete button or retry button
      if ((e.target as HTMLElement).closest("button")) return;

      // Prevent text selection while dragging
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const onMove = (ev: MouseEvent) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
          dragging = true;
          setIsDragging(true);
          setDraggingToEditor(true);
          // Prevent text selection across the page while dragging
          document.body.style.userSelect = "none";

          // Show floating preview card
          useAppStore.getState().setFloatingDragCard({
            content: snippet.content,
            label: snippet.label ?? null,
            labelStatus: snippet.label ? "done" : "loading",
          });
        }

        // Position floating card directly on DOM
        const card = document.querySelector("[data-floating-card]") as HTMLElement | null;
        if (card) {
          card.style.transform = `translate(${ev.clientX + 16}px, ${ev.clientY + 16}px)`;
          card.style.opacity = "1";
        }
      };

      const cleanupListeners = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      const onUp = (ev: MouseEvent) => {
        cleanupListeners();

        if (dragging) {
          const target = document.elementFromPoint(ev.clientX, ev.clientY);

          // Check: dropped on editor?
          const editorEl = document.querySelector(".tiptap-editor");
          if (editorEl && editorEl.contains(target)) {
            useAppStore.getState().setPendingSnippetInsert({
              snippetId: snippet.id,
              content: snippet.content,
              clientX: ev.clientX,
              clientY: ev.clientY,
            });
          }
          // Check: dropped on a short-form piece separator (ARI-154 drag
          // bridge)? Creates a new short-form piece at that position instead
          // of leaving the snip in the bar: the separator's data attributes
          // carry the idea id and the sort-order to insert at (see
          // piece-separator.tsx).
          const separatorEl = (target as Element | null)?.closest?.(
            "[data-piece-separator]",
          ) as HTMLElement | null;
          if (separatorEl) {
            const ideaId = separatorEl.getAttribute("data-idea-id");
            const insertOrderAttr = separatorEl.getAttribute("data-insert-order");
            const insertOrder = insertOrderAttr ? parseFloat(insertOrderAttr) : undefined;
            if (ideaId) {
              useContentStore.getState().createPiece({
                ideaId,
                format: "other",
                origin: "user",
                body: snippet.content,
                order: Number.isFinite(insertOrder) ? insertOrder : undefined,
              });
              removeSnippet(snippet.id);
            }
          }
          // Check: dropped on Snip Bar (reorder)?
          else {
            const dropZone = document.querySelector("[data-snip-bar-drop-zone]");
            if (dropZone && dropZone.contains(target)) {
              const idxAttr = dropZone.getAttribute("data-drop-index");
              const dropIdx = idxAttr ? parseInt(idxAttr, 10) : null;
              if (dropIdx !== null && Number.isFinite(dropIdx)) {
                const app = useAppStore.getState();
                // Reorder across everything the bar is showing, not just one
                // fragment's snippets: an idea's other fragments put their
                // snips in the same list (see snip-scope.ts).
                const allSnippets = visibleSnippets(
                  useDataStore.getState().snippets,
                  app.activePieceId,
                  app.activeIdeaId,
                );
                const currentIndex = allSnippets.findIndex((s) => s.id === snippet.id);
                if (currentIndex !== -1) {
                  const reordered = [...allSnippets];
                  const [moved] = reordered.splice(currentIndex, 1);
                  const insertAt = dropIdx > currentIndex ? dropIdx - 1 : dropIdx;
                  reordered.splice(insertAt, 0, moved);
                  useDataStore.getState().reorderSnippets(reordered.map((s, i) => ({ id: s.id, order: i })));
                }
              }
            }
          }

          // Clean up all drag state
          document.body.style.userSelect = "";
          setIsDragging(false);
          setDraggingToEditor(false);
          useAppStore.getState().setFloatingDragCard(null);
        }
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [snippet, setDraggingToEditor],
  );

  const handleMouseEnter = () => {
    if (isLong) {
      hoverTimeout.current = setTimeout(() => setShowHover(true), 400);
    }
  };

  const handleMouseLeave = () => {
    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
    setShowHover(false);
  };

  return (
    <div className="relative" ref={cardRef}>
      <div
        onMouseDown={handleMouseDown}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setShowHover(false);
          setContextMenuPosition({ x: event.clientX, y: event.clientY });
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={`group relative rounded-[var(--radius-default)] bg-surface-3 border border-border-strong
          hover:bg-surface-hover hover:border-border-active cursor-grab active:cursor-grabbing
          transition-all duration-150 ${isDragging ? "opacity-40" : ""}`}
        style={{ animation: "slideIn 0.2s ease-out" }}
      >
        {/* Label */}
        <div className="flex items-start gap-2.5 px-3.5 pt-3 pb-1.5">
          <GripVertical size={12} className="text-text-faint shrink-0 opacity-60 group-hover:opacity-100 transition-opacity duration-150" />
          <div className="flex-1 min-w-0">
            {snippet.labelStatus === "loading" ? (
              <div className="flex items-center gap-2">
                <Loader2
                  size={10}
                  className="text-gold shrink-0"
                  style={{ animation: "spin 1s linear infinite" }}
                />
                <span className="text-[10px] text-text-muted font-[family-name:var(--font-mono)] whitespace-normal break-words leading-relaxed">
                  Labeling...
                </span>
              </div>
            ) : snippet.labelStatus === "error" ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleRetryLabel(); }}
                className="flex items-center gap-2 hover:text-gold transition-colors duration-150"
                title="Click to retry labeling"
              >
                <RotateCcw size={10} className="text-text-muted hover:text-gold shrink-0" />
                <span className="text-[10px] text-text-muted hover:text-gold font-[family-name:var(--font-mono)] whitespace-normal break-words leading-relaxed">
                  Retry label
                </span>
              </button>
            ) : snippet.labelStatus === "idle" ? (
              <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] block whitespace-normal break-words leading-relaxed">
                —
              </span>
            ) : snippet.label ? (
              <span className="text-[10px] text-gold font-[family-name:var(--font-mono)] font-medium block whitespace-normal break-words leading-relaxed">
                {snippet.label}
              </span>
            ) : null}
          </div>
          <button
            onClick={() => removeSnippet(snippet.id)}
            className="opacity-0 group-hover:opacity-100 p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-red hover:bg-red-muted transition-all duration-150 mt-0.5"
          >
            <X size={12} />
          </button>
        </div>

        {/* Content preview */}
        <div className="px-3.5 pb-3.5">
          <p className="text-[12px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words font-[family-name:var(--font-body)]">
            {preview}
          </p>
        </div>
      </div>

      {contextMenuPosition && (
        <ContextMenu
          position={contextMenuPosition}
          onClose={() => setContextMenuPosition(null)}
          ariaLabel="Snippet actions"
        >
          <ContextMenuItem
            label="Insert into Editor"
            icon={<FileInput size={13} />}
            onSelect={handleInsertIntoEditor}
          />
          <ContextMenuItem
            label="Copy Text"
            shortcut="⌘C"
            icon={<Copy size={13} />}
            onSelect={() => void handleCopyText()}
          />
          <ContextMenuItem
            label="Re-label"
            icon={<Tags size={13} />}
            onSelect={handleRelabel}
          />
          <ContextMenuSeparator />
          <ContextMenuItem
            label="Delete Snippet"
            icon={<Trash2 size={13} />}
            destructive
            onSelect={handleDeleteFromMenu}
          />
        </ContextMenu>
      )}

      {/* Hover popup for full content */}
      {showHover && isLong && !isDragging && (
        <div
          className="absolute z-50 right-full mr-3 top-0 w-80 max-h-[70vh] overflow-y-auto
            bg-surface-3 border border-border-strong rounded-[var(--radius-lg)] shadow-2xl p-5"
          style={{ animation: "fadeIn 0.12s ease-out" }}
          onMouseEnter={() => setShowHover(true)}
          onMouseLeave={handleMouseLeave}
        >
          <p className="text-[12px] leading-relaxed text-text-primary whitespace-pre-wrap break-words font-[family-name:var(--font-body)] snippet-preview-content">
            {snippet.content}
          </p>
        </div>
      )}
    </div>
  );
}
