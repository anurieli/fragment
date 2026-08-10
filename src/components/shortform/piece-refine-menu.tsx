"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Scissors, Minimize2, Maximize2, Pencil, Loader2, X, ArrowRight, LayoutList } from "lucide-react";
import { estimateSelectionAnchor } from "@/lib/piece-ai";

type Mode = "idle" | "loading" | "custom-input";

interface PieceRefineMenuProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** The positioned ancestor (piece-card's root div) the menu's absolute
   * top/left resolve against — mirrors editor/inline-edit-menu.tsx anchoring
   * to the editor's scroll container rather than the viewport. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Runs the edit; returns the replacement text (or null on failure). Receives
   * the selection captured at click time so a slow AI call can't race a
   * moved cursor. */
  onEdit: (instruction: string, selectionStart: number, selectionEnd: number) => Promise<string | null>;
  onSnip: (selectionStart: number, selectionEnd: number) => void;
  /** Lift the selection into a new piece in the same idea, leaving this one as
   * it is — the short-form twin of the editor's Piece button. */
  onCapturePiece?: (selectionStart: number, selectionEnd: number) => void;
}

/**
 * Floating toolbar (Snip / Concise / Elaborate / Edit) for a piece-card's
 * plain textarea — the short-form analogue of editor/inline-edit-menu.tsx,
 * built without Tiptap since a textarea has no selection/decoration API of
 * its own. Anchors near the selection via getBoundingClientRect + an
 * approximate line-position estimate (see estimateSelectionAnchor); an
 * anchor at the textarea's own top edge is an acceptable fallback per spec.
 * Applies edits with textarea.setRangeText, which mutates the DOM value
 * directly (bypassing React's value-setter override), so a manually
 * dispatched "input" event is what makes the controlled textarea's React
 * state pick the change up — plain string in/out, whitespace outside the
 * selection untouched, and undo-friendly (setRangeText is a native editing
 * op the browser's own undo stack understands).
 */
export function PieceRefineMenu({ textareaRef, containerRef, onEdit, onSnip, onCapturePiece }: PieceRefineMenuProps) {
  const [mode, setMode] = useState<Mode>("idle");
  const [customPrompt, setCustomPrompt] = useState("");
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeEditRef = useRef(false);

  const updatePosition = useCallback(() => {
    const el = textareaRef.current;
    const container = containerRef.current;
    if (!el || !container || el.selectionStart === el.selectionEnd) {
      setAnchor(null);
      return;
    }
    const textareaRect = el.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const { top, left } = estimateSelectionAnchor(el.value, el.selectionStart, {
      top: textareaRect.top - containerRect.top,
      left: textareaRect.left - containerRect.left,
      scrollTop: el.scrollTop,
      lineHeight,
    });
    const menuHeight = 40;
    const gap = 8;
    const clampedTop = Math.max(0, top - menuHeight - gap);
    const clampedLeft = Math.max(0, Math.min(left, Math.max(0, containerRect.width - 240)));
    setAnchor({ top: clampedTop, left: clampedLeft });
  }, [textareaRef, containerRef]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    const handleSelectionChange = () => {
      if (activeEditRef.current) return;
      updatePosition();
    };
    const handleBlur = () => {
      setTimeout(() => {
        if (!menuRef.current?.contains(document.activeElement) && !activeEditRef.current) {
          setAnchor(null);
          setMode("idle");
          setCustomPrompt("");
        }
      }, 150);
    };

    el.addEventListener("select", handleSelectionChange);
    el.addEventListener("mouseup", handleSelectionChange);
    el.addEventListener("keyup", handleSelectionChange);
    el.addEventListener("blur", handleBlur);
    return () => {
      el.removeEventListener("select", handleSelectionChange);
      el.removeEventListener("mouseup", handleSelectionChange);
      el.removeEventListener("keyup", handleSelectionChange);
      el.removeEventListener("blur", handleBlur);
    };
  }, [textareaRef, updatePosition]);

  useEffect(() => {
    if (mode === "custom-input") inputRef.current?.focus();
  }, [mode]);

  const handlePresetEdit = useCallback(async (instruction: string) => {
    const el = textareaRef.current;
    if (!el || el.selectionStart === el.selectionEnd) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    setMode("loading");
    activeEditRef.current = true;
    const result = await onEdit(instruction, start, end);
    activeEditRef.current = false;

    if (result !== null) {
      el.focus();
      el.setRangeText(result, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    setMode("idle");
    setAnchor(null);
    setCustomPrompt("");
  }, [textareaRef, onEdit]);

  const handleCustomSubmit = useCallback(() => {
    const trimmed = customPrompt.trim();
    if (!trimmed) return;
    handlePresetEdit(trimmed);
  }, [customPrompt, handlePresetEdit]);

  const handleSnip = useCallback(() => {
    const el = textareaRef.current;
    if (!el || el.selectionStart === el.selectionEnd) return;
    onSnip(el.selectionStart, el.selectionEnd);
    setAnchor(null);
    setMode("idle");
  }, [textareaRef, onSnip]);

  const handleCapturePiece = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !onCapturePiece || el.selectionStart === el.selectionEnd) return;
    onCapturePiece(el.selectionStart, el.selectionEnd);
    setAnchor(null);
    setMode("idle");
  }, [textareaRef, onCapturePiece]);

  if (!anchor) return null;

  return (
    <div
      ref={menuRef}
      className="absolute z-50 pointer-events-auto"
      style={{ top: anchor.top, left: anchor.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        className="flex items-center gap-0.5 bg-surface-2 border border-border-strong rounded-[var(--radius-default)] shadow-xl px-1 py-1"
        style={{ animation: "fadeIn 0.12s ease-out" }}
      >
        {mode === "loading" ? (
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Loader2 size={13} className="animate-spin text-gold" />
            <span className="text-[11px] text-text-muted font-[family-name:var(--font-mono)]">Editing…</span>
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
            <button onClick={handleSnip} className="inline-edit-btn" title="Add to snippets">
              <Scissors size={12} />
              <span>Snip</span>
            </button>
            {onCapturePiece && (
              <button
                onClick={handleCapturePiece}
                className="inline-edit-btn"
                title="Start a new piece in this idea from this, without changing this one"
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
            <button onClick={() => setMode("custom-input")} className="inline-edit-btn" title="Custom edit">
              <Pencil size={12} />
              <span>Edit</span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
