"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { X, Loader2, GripVertical, RotateCcw } from "lucide-react";
import type { Snippet } from "@/lib/types";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useSnipLabeler } from "@/hooks/use-snip-labeler";
import { useToastStore } from "@/hooks/use-toast";
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  useContextMenu,
} from "@/components/common/context-menu";
import { visibleSnippets } from "@/lib/snip-scope";
import { DRAFT_FORMAT, PIECE_FORMAT, type PanelSection } from "@/lib/piece-section";
import { formatSnippetPreview } from "@/lib/utils";

interface SnippetCardProps {
  snippet: Snippet;
}

/**
 * Turn a snip into a fragment in `ideaId`'s `section`, and take it out of the
 * bar. Written here rather than in the drop handler because the right-click
 * menu offers the same move without a drag, and two routes to one outcome
 * that don't share code are two outcomes waiting to diverge.
 *
 * The snip leaves the bar because it has been spent: a snip is a thing set
 * aside to be placed somewhere, so leaving a copy behind would turn the bar
 * into a list of things you have already dealt with.
 *
 * Undo is exact: the snip is restored with its original id, order and label,
 * and the fragment it became is deleted.
 */
function fileSnipInto(snippet: Snippet, ideaId: string, section: PanelSection) {
  const pieceId = useContentStore.getState().createPiece({
    ideaId,
    format: section === "drafts" ? DRAFT_FORMAT : PIECE_FORMAT,
    origin: "user",
    // Out of your own bar, so it is already yours; the inbox is for what
    // arrived on its own.
    status: "in-progress",
    seen: true,
    // The label the AI wrote for the snip is already the sentence a person
    // would have named it with, so the row arrives named rather than as
    // "Empty piece".
    title: snippet.label ?? undefined,
    body: snippet.content,
  });
  if (!pieceId) return;

  const snapshot = { ...snippet };
  useDataStore.getState().removeSnippet(snippet.id);
  useToastStore.getState().showToast(
    section === "drafts" ? "Snip is a draft now" : "Snip is a piece now",
    {
      label: "Undo",
      onClick: () => {
        useContentStore.getState().deletePieceCascade(pieceId);
        useDataStore.getState().restoreSnippet(snapshot);
      },
    },
  );
}

export function SnippetCard({ snippet }: SnippetCardProps) {
  const removeSnippet = useDataStore((s) => s.removeSnippet);
  const updateSnippetLabel = useDataStore((s) => s.updateSnippetLabel);
  const updateSnippetContent = useDataStore((s) => s.updateSnippetContent);
  const setDraggingToEditor = useAppStore((s) => s.setDraggingToEditor);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const showToast = useToastStore((s) => s.showToast);
  const labelSnip = useSnipLabeler();
  const [showHover, setShowHover] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const { point, openAt, close } = useContextMenu();
  const hoverTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /** True once this edit has been resolved, saved or abandoned. See commitEdit. */
  const settled = useRef(true);

  const preview = formatSnippetPreview(snippet.content);
  const isLong =
    snippet.content.split("\n").length > 6 || snippet.content.length > 200;
  // The bar is scoped to the open idea, so that is where a snip files itself;
  // its own ideaId is the fallback for a snip cut before an idea was open.
  const homeIdeaId = activeIdeaId ?? snippet.ideaId ?? null;

  const handleRetryLabel = useCallback(() => {
    updateSnippetLabel(snippet.id, null, "loading");
    labelSnip(snippet.id, snippet.content, { pieceId: snippet.pieceId ?? null, ideaId: snippet.ideaId });
  }, [snippet, updateSnippetLabel, labelSnip]);

  /**
   * Put the snip into the open draft at the cursor, without a drag. The drag
   * lands it where the pointer is; this lands it where you were last typing,
   * which is the useful answer when the draft is scrolled somewhere else or
   * you are working from the keyboard.
   *
   * Sending no coordinates is what says "at the selection" — see
   * PendingSnippetInsert in the app store.
   */
  const handleInsertIntoEditor = useCallback(() => {
    const app = useAppStore.getState();
    if (!app.activePieceId) {
      showToast("Open or create a draft before inserting a snippet.");
      return;
    }
    app.setPendingSnippetInsert({ snippetId: snippet.id, content: snippet.content });
    if (app.activeIdeaId) app.setIdeaSpace(app.activeIdeaId, "write");
  }, [snippet, showToast]);

  const startEditing = useCallback(() => {
    setShowHover(false);
    setDraft(snippet.content);
    settled.current = false;
    setEditing(true);
  }, [snippet.content]);

  /**
   * Clicking away saves, which is the whole gesture: you opened the words, you
   * changed them, you looked elsewhere. Escape is the way to leave them alone.
   *
   * An emptied box is not a way to delete a snip. There is an X for that, and
   * a stray select-and-type would otherwise destroy the only copy of something
   * cut out of a draft.
   */
  const commitEdit = useCallback(() => {
    // Two things can end one edit — the press that lands outside and the blur
    // it causes — and the second must not re-save words the first already
    // saved, since saving is what asks the AI for a fresh label.
    if (settled.current) return;
    settled.current = true;
    setEditing(false);
    const next = draft.trim();
    if (!next || next === snippet.content) return;
    updateSnippetContent(snippet.id, next);
    // The label describes words that have just changed, so it has to be
    // earned again rather than left behind describing the old ones.
    updateSnippetLabel(snippet.id, null, "loading");
    labelSnip(snippet.id, next, { pieceId: snippet.pieceId ?? null, ideaId: snippet.ideaId });
  }, [draft, snippet, updateSnippetContent, updateSnippetLabel, labelSnip]);

  const cancelEdit = useCallback(() => {
    settled.current = true;
    setEditing(false);
  }, []);

  /**
   * Clicking anywhere outside saves, which is what "click out" means to the
   * hand holding the mouse. Blur alone is not enough: the editor swallows the
   * mousedown when the press lands inside its current selection, so focus
   * never actually leaves the box and the words would sit there unsaved
   * looking saved. Listening for the press itself is the only version that
   * cannot be defeated by wherever you happened to click.
   */
  useEffect(() => {
    if (!editing) return;
    function onPointerDown(e: MouseEvent) {
      if (cardRef.current?.contains(e.target as Node)) return;
      commitEdit();
    }
    document.addEventListener("mousedown", onPointerDown, true);
    return () => document.removeEventListener("mousedown", onPointerDown, true);
  }, [editing, commitEdit]);

  // Custom mouse-based drag (replaces native DnD which fails in Tauri/WKWebView)
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Don't start drag from delete button or retry button
      if ((e.target as HTMLElement).closest("button")) return;
      // While the words are open for editing the card is a text box, not a
      // handle: selecting a phrase inside it must not fling the snip somewhere.
      if (editing) return;

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
          // Check: dropped on one of the idea panel's two lists? Same trade as
          // the separator below — the snip becomes a fragment there and leaves
          // the bar — but the list decides the shape, Drafts making a
          // long-form draft and Pieces a card in the feed (see
          // piece-section.ts and the DropSection in idea-panel.tsx).
          const zoneEl = (target as Element | null)?.closest?.(
            "[data-idea-drop]",
          ) as HTMLElement | null;
          const zoneIdeaId = zoneEl?.getAttribute("data-idea-id");
          const zoneSection = zoneEl?.getAttribute("data-idea-drop") as PanelSection | null;
          if (zoneEl && zoneIdeaId && zoneSection) {
            fileSnipInto(snippet, zoneIdeaId, zoneSection);
          }
          // Check: dropped on a short-form piece separator (ARI-154 drag
          // bridge)? Creates a new short-form piece at that position instead
          // of leaving the snip in the bar: the separator's data attributes
          // carry the idea id and the sort-order to insert at (see
          // piece-separator.tsx).
          else if ((target as Element | null)?.closest?.("[data-piece-separator]")) {
            const separatorEl = (target as Element).closest(
              "[data-piece-separator]",
            ) as HTMLElement;
            const ideaId = separatorEl.getAttribute("data-idea-id");
            const insertOrderAttr = separatorEl.getAttribute("data-insert-order");
            const insertOrder = insertOrderAttr ? parseFloat(insertOrderAttr) : undefined;
            if (ideaId) {
              useContentStore.getState().createPiece({
                ideaId,
                format: "other",
                origin: "user",
                // Dragged out of your own snip bar, so it is already yours.
                status: "in-progress",
                seen: true,
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
    [snippet, setDraggingToEditor, editing, removeSnippet],
  );

  const handleMouseEnter = () => {
    if (isLong && !editing) {
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
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onDoubleClick={() => { if (!editing) startEditing(); }}
        // Not while editing: inside a text box the browser's own menu is the
        // one that matters, since that is where spellcheck and paste live.
        onContextMenu={(e) => { if (!editing) openAt(e); }}
        title={editing ? undefined : "Double-click to edit. Drag it into the draft, the feed, or the idea panel"}
        className={`group relative rounded-[var(--radius-default)] bg-surface-3 border transition-all duration-150
          ${editing
            ? "border-border-active cursor-text"
            : "border-border-strong hover:bg-surface-hover hover:border-border-active cursor-grab active:cursor-grabbing"}
          ${isDragging ? "opacity-40" : ""}`}
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

        {/* Content: the trimmed preview, or the whole thing when you're in it */}
        <div className="px-3.5 pb-3.5">
          {editing ? (
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onBlur={commitEdit}
              onKeyDown={(e) => {
                // Enter belongs to the writing: a snip is prose and often
                // several lines of it. ⌘⏎ is the way to say "done" without
                // reaching for the mouse.
                e.stopPropagation();
                if (e.key === "Escape") cancelEdit();
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
              }}
              rows={Math.min(14, Math.max(3, draft.split("\n").length + 1))}
              className="w-full resize-none bg-surface-2 border border-border-active rounded-[var(--radius-sm)]
                px-2 py-1.5 text-[12px] leading-relaxed text-text-primary outline-none
                font-[family-name:var(--font-body)]"
            />
          ) : (
            <p className="text-[12px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words font-[family-name:var(--font-body)]">
              {preview}
            </p>
          )}
        </div>
      </div>

      {point && (
        <ContextMenu point={point} onClose={close}>
          <ContextMenuItem
            label="Edit the words"
            hint="Double-clicking the snip does this too"
            onClick={() => { close(); startEditing(); }}
          />
          <ContextMenuItem
            label="Insert into the draft"
            hint="At the cursor, rather than where you drop it"
            onClick={() => { close(); handleInsertIntoEditor(); }}
          />
          <ContextMenuItem
            label="Copy"
            onClick={() => {
              close();
              navigator.clipboard
                .writeText(snippet.content)
                .then(() => showToast("Copied."))
                .catch(() => showToast("Couldn't reach the clipboard."));
            }}
          />
          {snippet.labelStatus !== "loading" && (
            <ContextMenuItem
              label={snippet.label ? "Label it again" : "Label it"}
              hint="A one-line description, written for you"
              onClick={() => { close(); handleRetryLabel(); }}
            />
          )}

          <ContextMenuDivider />

          <ContextMenuItem
            label="Make it a draft"
            disabled={!homeIdeaId}
            title={homeIdeaId ? undefined : "Open an idea first — a draft has to live in one"}
            hint="Leaves the bar and opens in the editor"
            onClick={() => { close(); if (homeIdeaId) fileSnipInto(snippet, homeIdeaId, "drafts"); }}
          />
          <ContextMenuItem
            label="Make it a piece"
            disabled={!homeIdeaId}
            title={homeIdeaId ? undefined : "Open an idea first — a piece has to live in one"}
            hint="Leaves the bar and lands in the feed"
            onClick={() => { close(); if (homeIdeaId) fileSnipInto(snippet, homeIdeaId, "pieces"); }}
          />

          <ContextMenuDivider />

          <ContextMenuItem
            label="Delete"
            destructive
            onClick={() => { close(); removeSnippet(snippet.id); }}
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
