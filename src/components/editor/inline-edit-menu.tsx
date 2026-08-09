"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { Scissors, Minimize2, Maximize2, Pencil, Loader2, X, ArrowRight, Lightbulb } from "lucide-react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { calculateInlineMenuPosition } from "@/lib/inline-menu-placement";

type EditMode = "idle" | "loading" | "custom-input";

interface InlineEditMenuProps {
  editor: TiptapEditor;
  onSnip: () => void;
  onEdit: (instruction: string) => Promise<string | null>;
  /** Turn the selection into an idea of its own. Receives the selected text;
   * the draft it was cut from is left alone. */
  onCaptureIdea?: (text: string) => void;
}

export function InlineEditMenu({ editor, onSnip, onEdit, onCaptureIdea }: InlineEditMenuProps) {
  const [mode, setMode] = useState<EditMode>("idle");
  const [customPrompt, setCustomPrompt] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeEditRef = useRef(false);

  const updatePosition = useCallback(() => {
    const { from, to } = editor.state.selection;
    const menuHasFocus = menuRef.current?.contains(document.activeElement) ?? false;
    const customEditIsOpen = mode === "custom-input";
    if (
      from === to
      || (!editor.isFocused && !menuHasFocus && !customEditIsOpen && !activeEditRef.current)
    ) {
      setVisible(false);
      return;
    }

    const startCoords = editor.view.coordsAtPos(from);
    const endCoords = editor.view.coordsAtPos(to);

    const editorDom = editor.view.dom.closest(".overflow-y-auto");
    if (!editorDom) {
      setVisible(false);
      return;
    }

    const editorRect = editorDom.getBoundingClientRect();
    const nextPosition = calculateInlineMenuPosition({
      selection: {
        top: startCoords.top,
        right: endCoords.right,
        bottom: endCoords.bottom,
        left: startCoords.left,
      },
      container: {
        top: editorRect.top,
        right: editorRect.right,
        bottom: editorRect.bottom,
        left: editorRect.left,
      },
      scrollTop: editorDom.scrollTop,
      scrollLeft: editorDom.scrollLeft,
      menu: {
        width: menuRef.current?.offsetWidth ?? 320,
        height: menuRef.current?.offsetHeight ?? 40,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });

    if (!nextPosition) {
      setVisible(false);
      return;
    }

    setPosition({ top: nextPosition.top, left: nextPosition.left });
    setVisible(true);
  }, [editor, mode]);

  // Selection can already exist when this component mounts or when the editor
  // regains focus without changing the ProseMirror range. Check immediately and
  // listen at both the editor and DOM boundaries so mouse, keyboard, and focus
  // selection paths all reveal the toolbar.
  useEffect(() => {
    const reset = () => {
      setVisible(false);
      setMode("idle");
      setCustomPrompt("");
    };
    const handleSelectionUpdate = () => {
      if (activeEditRef.current) return;

      const { from, to } = editor.state.selection;
      if (from === to) {
        reset();
        return;
      }
      updatePosition();
    };
    const handleBlur = () => {
      // Small delay to allow clicking the menu itself.
      setTimeout(() => {
        if (!menuRef.current?.contains(document.activeElement) && !activeEditRef.current) {
          reset();
        }
      }, 150);
    };
    const handleDomSelection = () => requestAnimationFrame(handleSelectionUpdate);

    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("focus", handleSelectionUpdate);
    editor.on("blur", handleBlur);
    editor.view.dom.addEventListener("mouseup", handleDomSelection);
    editor.view.dom.addEventListener("keyup", handleDomSelection);
    handleSelectionUpdate();

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("focus", handleSelectionUpdate);
      editor.off("blur", handleBlur);
      editor.view.dom.removeEventListener("mouseup", handleDomSelection);
      editor.view.dom.removeEventListener("keyup", handleDomSelection);
    };
  }, [editor, updatePosition]);

  // Remeasure after the toolbar mounts or changes mode, since the custom input
  // and loading states have different dimensions.
  useLayoutEffect(() => {
    if (!visible || !menuRef.current) return;
    updatePosition();

    const observer = new ResizeObserver(updatePosition);
    observer.observe(menuRef.current);
    return () => observer.disconnect();
  }, [visible, mode, updatePosition]);

  // coordsAtPos reports viewport coordinates, so remeasure whenever either the
  // editor or the page scrolls and whenever the viewport changes size.
  useEffect(() => {
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [updatePosition]);

  // Restore focus when the custom input remounts after its selection returns
  // to the viewport as well as when the mode first opens.
  useEffect(() => {
    if (mode === "custom-input" && visible) {
      inputRef.current?.focus();
    }
  }, [mode, visible]);

  const handlePresetEdit = useCallback(async (instruction: string) => {
    setMode("loading");
    activeEditRef.current = true;

    const result = await onEdit(instruction);

    activeEditRef.current = false;

    if (result !== null) {
      // Replace the selection with the result
      const { from, to } = editor.state.selection;
      editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, result)
        .run();
    }

    setMode("idle");
    setVisible(false);
    setCustomPrompt("");
  }, [editor, onEdit]);

  const handleCustomSubmit = useCallback(() => {
    const trimmed = customPrompt.trim();
    if (!trimmed) return;
    handlePresetEdit(trimmed);
  }, [customPrompt, handlePresetEdit]);

  const handleSnip = useCallback(() => {
    onSnip();
    setVisible(false);
    setMode("idle");
  }, [onSnip]);

  const handleCaptureIdea = useCallback(() => {
    if (!onCaptureIdea) return;
    const { from, to } = editor.state.selection;
    // Block separator, so a multi-paragraph selection arrives as paragraphs
    // rather than one run-on line.
    const text = editor.state.doc.textBetween(from, to, "\n\n", " ").trim();
    if (!text) return;
    onCaptureIdea(text);
    setVisible(false);
    setMode("idle");
  }, [editor, onCaptureIdea]);

  if (!visible || !position) return null;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 pointer-events-auto"
      style={{
        top: position.top,
        left: position.left,
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        className="flex items-center gap-0.5 bg-surface-2 border border-border-strong rounded-[var(--radius-default)] shadow-xl px-1 py-1"
        style={{ animation: "fadeIn 0.12s ease-out" }}
      >
        {mode === "loading" ? (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Loader2 size={13} className="animate-spin text-gold" />
            <span className="text-[11px] text-text-muted font-[family-name:var(--font-mono)]">
              Editing…
            </span>
          </div>
        ) : mode === "custom-input" ? (
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setMode("idle"); setCustomPrompt(""); }}
              className="p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-text-muted transition-colors duration-100"
            >
              <X size={12} />
            </button>
            <input
              ref={inputRef}
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
                if (e.key === "Escape") { setMode("idle"); setCustomPrompt(""); }
              }}
              placeholder="Tell me how to edit this…"
              className="bg-transparent text-[12px] text-text-primary placeholder:text-text-faint outline-none w-[220px] font-[family-name:var(--font-body)]"
            />
            <button
              onClick={handleCustomSubmit}
              disabled={!customPrompt.trim()}
              className="p-1.5 rounded-[var(--radius-sm)] text-gold hover:text-gold-hover transition-colors duration-100 disabled:opacity-30 disabled:pointer-events-none"
            >
              <ArrowRight size={13} />
            </button>
          </div>
        ) : (
          <>
            <button
              onClick={handleSnip}
              className="inline-edit-btn"
              title="Add to snippets"
            >
              <Scissors size={12} />
              <span>Snip</span>
            </button>
            {onCaptureIdea && (
              <button
                onClick={handleCaptureIdea}
                className="inline-edit-btn"
                title="Start a new idea from this, without changing what you are writing"
              >
                <Lightbulb size={12} />
                <span>Idea</span>
              </button>
            )}
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              onClick={() => handlePresetEdit("Make this more concise. Tighten the language, remove redundancy, keep the core meaning.")}
              className="inline-edit-btn"
              title="Make concise"
            >
              <Minimize2 size={12} />
              <span>Concise</span>
            </button>
            <button
              onClick={() => handlePresetEdit("Elaborate on this. Add more detail, examples, or nuance while keeping the same voice.")}
              className="inline-edit-btn"
              title="Elaborate"
            >
              <Maximize2 size={12} />
              <span>Elaborate</span>
            </button>
            <div className="w-px h-4 bg-border mx-0.5" />
            <button
              onClick={() => setMode("custom-input")}
              className="inline-edit-btn"
              title="Custom edit"
            >
              <Pencil size={12} />
              <span>Edit</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
