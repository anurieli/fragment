"use client";

import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { PanelRightClose, Puzzle } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useLabelSnippet } from "@/hooks/use-label-snippet";
import { SnippetCard } from "./snippet-card";

export function HelperBar() {
  const { activeNoteId, closeHelperBar, isDraggingToHelper, isDraggingToEditor } = useAppStore();
  const { notes, snippets, addSnippet, reorderSnippets } = useDataStore();
  const { labelSnippet } = useLabelSnippet();
  const [dragOver, setDragOver] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [draggingSnippetId, setDraggingSnippetId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevDraggingHelperRef = useRef(isDraggingToHelper);
  const prevDraggingEditorRef = useRef(isDraggingToEditor);

  // Reset local drag visuals when any custom drag ends
  useEffect(() => {
    if ((prevDraggingHelperRef.current && !isDraggingToHelper) ||
        (prevDraggingEditorRef.current && !isDraggingToEditor)) {
      setDragOver(false);
      setDropIndex(null);
    }
    prevDraggingHelperRef.current = isDraggingToHelper;
    prevDraggingEditorRef.current = isDraggingToEditor;
  }, [isDraggingToHelper, isDraggingToEditor]);

  const note = activeNoteId ? notes[activeNoteId] : null;

  const noteSnippets = useMemo(
    () =>
      Object.values(snippets)
        .filter((s) => s.noteId === activeNoteId)
        .sort((a, b) => a.order - b.order),
    [snippets, activeNoteId],
  );

  const getDropIndex = useCallback(
    (clientY: number) => {
      if (!listRef.current) return noteSnippets.length;
      const cards = listRef.current.querySelectorAll("[data-snippet-card]");
      for (let i = 0; i < cards.length; i++) {
        const rect = cards[i].getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (clientY < midY) return i;
      }
      return noteSnippets.length;
    },
    [noteSnippets.length],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const reorderData = e.dataTransfer.types.includes(
        "application/x-fragment-reorder",
      );
      const isSnippetReorder = !!draggingSnippetId || reorderData;
      e.dataTransfer.dropEffect = isSnippetReorder ? "move" : "copy";
      if (!dragOver) setDragOver(true);

      const snippetData = e.dataTransfer.types.includes(
        "application/x-fragment-snippet",
      );
      const insertData = e.dataTransfer.types.includes(
        "application/x-fragment-insert",
      );

      if (isSnippetReorder || snippetData || insertData || isDraggingToHelper) {
        setDropIndex(getDropIndex(e.clientY));
      }
    },
    [dragOver, draggingSnippetId, isDraggingToHelper, getDropIndex],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setDragOver(false);
    setDropIndex(null);
  }, []);

  // Mouse event handlers for custom drag (editor→snippet or snippet reorder)
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDraggingToHelper && !isDraggingToEditor) return;
      if (!dragOver) setDragOver(true);
      setDropIndex(getDropIndex(e.clientY));
    },
    [isDraggingToHelper, isDraggingToEditor, dragOver, getDropIndex],
  );

  const handleMouseLeave = useCallback(() => {
    if (!isDraggingToHelper && !isDraggingToEditor) return;
    setDragOver(false);
    setDropIndex(null);
  }, [isDraggingToHelper, isDraggingToEditor]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const targetIndex = dropIndex ?? getDropIndex(e.clientY);
      setDropIndex(null);
      const draggedId = draggingSnippetId;
      setDraggingSnippetId(null);

      if (!activeNoteId || !note) return;

      // Handle drag-back of pending snippet (reversible drop cancel)
      const pendingReturnData = e.dataTransfer.getData(
        "application/x-fragment-pending-return",
      );
      if (pendingReturnData) {
        const { cancelPendingDrop } = useAppStore.getState();
        cancelPendingDrop();
        return;
      }

      // Handle reorder within helper bar
      const reorderData = e.dataTransfer.getData("application/x-fragment-reorder");
      const reorderId = (() => {
        if (draggedId) return draggedId;
        if (!reorderData) return null;
        try {
          const { id } = JSON.parse(reorderData) as { id?: string };
          return id ?? null;
        } catch {
          return null;
        }
      })();
      if (reorderId) {
        const currentIndex = noteSnippets.findIndex((s) => s.id === reorderId);
        if (currentIndex === -1) return;

        const reordered = [...noteSnippets];
        const [moved] = reordered.splice(currentIndex, 1);
        const insertAt =
          targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
        reordered.splice(insertAt, 0, moved);

        reorderSnippets(reordered.map((s, i) => ({ id: s.id, order: i })));
        return;
      }

      // Handle new snippet from editor
      const snippetData = e.dataTransfer.getData(
        "application/x-fragment-snippet",
      );
      const plainText = e.dataTransfer.getData("text/plain");

      let content = "";
      let editorFrom: number | undefined;
      let editorTo: number | undefined;
      if (snippetData) {
        try {
          const parsed = JSON.parse(snippetData);
          content = parsed.content;
          editorFrom = parsed.editorFrom;
          editorTo = parsed.editorTo;
        } catch {
          content = snippetData;
        }
      } else if (plainText) {
        content = plainText;
      }

      if (!content.trim()) return;

      // Add snippet first to get its ID for undo tracking
      const snippetId = addSnippet(activeNoteId, content, targetIndex);

      // Tell editor to delete the source text (pass snippetId for undo/redo sync)
      if (editorFrom !== undefined && editorTo !== undefined) {
        const { setPendingEditorDeletion } = useAppStore.getState();
        setPendingEditorDeletion({ from: editorFrom, to: editorTo, snippetId });
      }

      // Use pre-fetched label from floating card if available, then clear it
      const floatingCard = useAppStore.getState().floatingDragCard;
      if (floatingCard && floatingCard.labelStatus === "done" && floatingCard.label) {
        const { updateSnippetLabel } = useDataStore.getState();
        updateSnippetLabel(snippetId, floatingCard.label, "done");
      } else {
        labelSnippet(snippetId, content, note.content, note.goal, activeNoteId);
      }
      useAppStore.getState().setFloatingDragCard(null);
    },
    [
      activeNoteId,
      note,
      noteSnippets,
      dropIndex,
      addSnippet,
      labelSnippet,
      reorderSnippets,
      getDropIndex,
      draggingSnippetId,
    ],
  );

  return (
    <div className="flex flex-col h-full w-[320px] bg-surface-2">
      {/* Header */}
      <div className="flex items-center justify-between px-5 h-14 shrink-0">
        <div className="flex items-center gap-2.5">
          <Puzzle size={14} className="text-text-muted" />
          <span className="text-[13px] font-medium text-text-secondary">
            Snip Bar
          </span>
          {noteSnippets.length > 0 && (
            <span className="text-[11px] text-text-faint font-[family-name:var(--font-mono)]">
              {noteSnippets.length}
            </span>
          )}
        </div>
        <button
          onClick={closeHelperBar}
          className="p-1.5 rounded-[var(--radius-sm)] text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-all duration-150"
        >
          <PanelRightClose size={15} />
        </button>
      </div>

      {/* Drop zone / snippet list */}
      <div
        data-snip-bar-drop-zone
        data-drop-index={dropIndex ?? ""}
        className={`flex-1 overflow-y-auto p-4 transition-colors duration-150 ${
          dragOver || isDraggingToHelper ? "bg-gold-muted/20" : ""
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {noteSnippets.length === 0 && !dragOver && !isDraggingToHelper ? (
          <div className="flex flex-col items-center justify-center h-full rounded-[var(--radius-lg)] border border-dashed border-border-strong text-text-faint">
            <Puzzle size={24} className="mb-3 opacity-40" />
            <p className="text-[13px] font-medium mb-1.5 text-text-muted">No snippets yet</p>
            <p className="text-[12px] text-text-faint text-center px-6 leading-relaxed">
              Select text and drag it here, or use the Snip button
            </p>
          </div>
        ) : (
          <div ref={listRef} className="space-y-0">
            {noteSnippets.map((snippet, index) => (
              <div key={snippet.id}>
                {/* Drop indicator BEFORE this card */}
                {dropIndex === index && (
                  <div className="h-0.5 bg-gold rounded-full mx-2 my-1.5" style={{ animation: "fadeIn 0.1s ease-out" }} />
                )}
                <div
                  className="py-1"
                  data-snippet-card
                  onDragStart={() => setDraggingSnippetId(snippet.id)}
                  onDragEnd={() => setDraggingSnippetId(null)}
                >
                  <SnippetCard snippet={snippet} />
                </div>
              </div>
            ))}
            {/* Drop indicator at the END */}
            {dropIndex === noteSnippets.length && (
              <div className="h-0.5 bg-gold rounded-full mx-2 my-1.5" style={{ animation: "fadeIn 0.1s ease-out" }} />
            )}
            {/* General drop zone when dragging from editor */}
            {(dragOver || isDraggingToHelper) &&
              dropIndex === null &&
              noteSnippets.length === 0 && (
                <div className="h-16 rounded-[var(--radius-default)] border border-dashed border-gold flex items-center justify-center">
                  <span className="text-[12px] text-gold font-medium">
                    Drop here
                  </span>
                </div>
              )}
          </div>
        )}
      </div>
    </div>
  );
}
