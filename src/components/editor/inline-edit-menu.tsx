"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { Scissors, Minimize2, Maximize2, Pencil, Loader2, X, ArrowRight } from "lucide-react";
import type { Editor as TiptapEditor } from "@tiptap/core";

type EditMode = "idle" | "loading" | "custom-input";

interface InlineEditMenuProps {
  editor: TiptapEditor;
  onSnip: () => void;
  onEdit: (instruction: string) => Promise<string | null>;
}

export function InlineEditMenu({ editor, onSnip, onEdit }: InlineEditMenuProps) {
  const [mode, setMode] = useState<EditMode>("idle");
  const [customPrompt, setCustomPrompt] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeEditRef = useRef(false);

  const updatePosition = useCallback(() => {
    const { from, to } = editor.state.selection;
    if (from === to) {
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
    const centerX = (startCoords.left + endCoords.right) / 2;

    const menuHeight = 40;
    const gap = 8;

    // Default: position above the selection
    let top = startCoords.top - editorRect.top - menuHeight - gap;

    // If menu would be cut off at the top, flip to below the selection
    if (top < 0) {
      top = endCoords.bottom - editorRect.top + gap;
    }

    setPosition({
      top,
      left: centerX - editorRect.left,
    });
    setVisible(true);
  }, [editor]);

  // Listen to selection changes
  useEffect(() => {
    const handleSelectionUpdate = () => {
      if (activeEditRef.current) return;

      const { from, to } = editor.state.selection;
      if (from === to) {
        setVisible(false);
        setMode("idle");
        setCustomPrompt("");
        return;
      }
      updatePosition();
    };

    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("blur", () => {
      // Small delay to allow clicking the menu itself
      setTimeout(() => {
        if (!menuRef.current?.contains(document.activeElement) && !activeEditRef.current) {
          setVisible(false);
          setMode("idle");
          setCustomPrompt("");
        }
      }, 150);
    });

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, updatePosition]);

  // Clamp menu horizontally so it never overflows the editor bounds
  useLayoutEffect(() => {
    if (!visible || !position || !menuRef.current) return;

    const menu = menuRef.current;
    const editorDom = editor.view.dom.closest(".overflow-y-auto");
    if (!editorDom) return;

    const containerWidth = editorDom.clientWidth;
    const menuWidth = menu.offsetWidth;
    const halfWidth = menuWidth / 2;
    const padding = 8;

    let translateX = -halfWidth; // default: center on position.left

    // Would overflow left
    if (position.left + translateX < padding) {
      translateX = padding - position.left;
    }
    // Would overflow right
    else if (position.left + translateX + menuWidth > containerWidth - padding) {
      translateX = containerWidth - padding - menuWidth - position.left;
    }

    menu.style.transform = `translateX(${translateX}px)`;
  }, [visible, position, mode, editor]);

  // Focus custom input when mode switches
  useEffect(() => {
    if (mode === "custom-input") {
      inputRef.current?.focus();
    }
  }, [mode]);

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
