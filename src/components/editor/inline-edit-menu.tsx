"use client";

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { Scissors, Minimize2, Maximize2, Pencil, Loader2, X, ArrowRight, LayoutList } from "lucide-react";
import type { Editor as TiptapEditor } from "@tiptap/core";

type EditMode = "idle" | "loading" | "custom-input";

interface InlineEditMenuProps {
  editor: TiptapEditor;
  onSnip: () => void;
  onEdit: (instruction: string) => Promise<string | null>;
  /** Turn the selection into a piece of its own, inside the same idea.
   * Receives the selected text; the draft it was cut from is left alone. */
  onCapturePiece?: (text: string) => void;
}

export function InlineEditMenu({ editor, onSnip, onEdit, onCapturePiece }: InlineEditMenuProps) {
  const [mode, setMode] = useState<EditMode>("idle");
  /** True while the toolbar is down only because its selection scrolled out
   * of view, which is what tells the scroll handler to put it back. */
  const hiddenByScrollRef = useRef(false);
  const [customPrompt, setCustomPrompt] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeEditRef = useRef(false);
  const menuHeightRef = useRef(40);

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

    // coordsAtPos returns viewport coordinates, but this menu is absolutely
    // positioned inside the scroll container, where `top` is measured from the
    // top of the scrolled content. Without the scroll term the menu lands
    // scrollTop pixels too high — invisible once you are any distance down the
    // page. Same offset the drop-indicator overlay in editor.tsx uses.
    const offsetY = editorDom.scrollTop - editorRect.top;

    // Measured height, not a guess: the menu is taller in custom-input mode.
    // Kept in a ref because the first pass runs before the menu is in the DOM
    // (see the layout effect below, which corrects it once it is).
    const menuHeight = menuHeightRef.current;
    const gap = 8;

    // Default: position above the selection
    let top = startCoords.top + offsetY - menuHeight - gap;

    // If the menu would sit above the visible top edge, flip below the
    // selection. The visible top edge is scrollTop in content coordinates.
    if (top < editorDom.scrollTop) {
      top = endCoords.bottom + offsetY + gap;
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

    // A selection can already be standing when this mounts (the menu is
    // remounted while text stays highlighted). Tiptap only fires
    // selectionUpdate on a *change*, so without this first read the toolbar
    // would sit invisible over a selection the writer can see.
    handleSelectionUpdate();

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

  // Follow the selection as the page scrolls. The menu is anchored to text,
  // so text scrolled out of the visible band should take its toolbar with it,
  // and bring it back on the way in. Only `visible` is toggled: mode and any
  // half-typed custom instruction survive the round trip, because losing a
  // sentence you were mid-way through writing to a scroll is not a tradeoff
  // anyone accepts.
  useEffect(() => {
    if (!visible && !hiddenByScrollRef.current) return;

    const onScroll = () => {
      const editorDom = editor.view.dom.closest(".overflow-y-auto");
      if (!editorDom) return;

      const { from, to } = editor.state.selection;
      if (from === to) return;

      const rect = editorDom.getBoundingClientRect();
      const startCoords = editor.view.coordsAtPos(from);
      const offscreen = startCoords.bottom < rect.top || startCoords.top > rect.bottom;

      if (offscreen) {
        if (!hiddenByScrollRef.current) {
          hiddenByScrollRef.current = true;
          setVisible(false);
        }
        return;
      }

      if (hiddenByScrollRef.current) {
        hiddenByScrollRef.current = false;
        updatePosition();
      }
    };

    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [editor, visible, updatePosition]);

  // A custom instruction that was on screen, scrolled away, and came back
  // deserves the cursor it had. The focus effect below keys on mode, which
  // does not change across a scroll, so it cannot do this on its own.
  useEffect(() => {
    if (visible && mode === "custom-input") {
      inputRef.current?.focus();
    }
  }, [visible, mode]);

  // Reposition on window resize: the selection has not moved, but the column
  // it sits in has, so the cached coordinates are stale.
  useEffect(() => {
    if (!visible) return;
    const onResize = () => updatePosition();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible, updatePosition]);

  // Clamp menu horizontally so it never overflows the editor bounds, and
  // correct the vertical placement once the menu's real height is known
  // (it grows when the custom-instruction input opens).
  useLayoutEffect(() => {
    if (!visible || !position || !menuRef.current) return;

    const menu = menuRef.current;
    const editorDom = editor.view.dom.closest(".overflow-y-auto");
    if (!editorDom) return;

    const measured = menu.offsetHeight;
    if (measured && measured !== menuHeightRef.current) {
      menuHeightRef.current = measured;
      updatePosition();
      return; // this effect re-runs with the corrected position
    }

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
  }, [visible, position, mode, editor, updatePosition]);

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

  const handleCapturePiece = useCallback(() => {
    if (!onCapturePiece) return;
    const { from, to } = editor.state.selection;
    // Block separator, so a multi-paragraph selection arrives as paragraphs
    // rather than one run-on line.
    const text = editor.state.doc.textBetween(from, to, "\n\n", " ").trim();
    if (!text) return;
    onCapturePiece(text);
    setVisible(false);
    setMode("idle");
  }, [editor, onCapturePiece]);

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
            {onCapturePiece && (
              <button
                onClick={handleCapturePiece}
                className="inline-edit-btn"
                title="Start a new piece in this idea from this, without changing what you are writing"
              >
                <LayoutList size={12} />
                <span>Piece</span>
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
