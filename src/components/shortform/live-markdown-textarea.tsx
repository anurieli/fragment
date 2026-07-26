"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";
import { highlightMarkdown } from "@/lib/markdown-highlight";

interface LiveMarkdownTextareaProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /**
   * The mirror, handed back to the caller. A textarea can't say where its
   * selection sits on screen; the mirror lays the same string out the same
   * way, so it can — that's what makes a selection draggable out of a piece
   * (see lib/textarea-selection.ts).
   */
  mirrorRef?: RefObject<HTMLDivElement | null>;
}

/**
 * A plain textarea that *looks* like live markdown while you type.
 *
 * The text you edit is still one raw string in a real `<textarea>` — native
 * undo, spellcheck, IME, and byte-exact whitespace all intact, which is the
 * promise short-form publishing rests on. The formatting is a highlighted
 * copy of that same string painted directly behind it (`highlightMarkdown`),
 * with the textarea's own glyphs made transparent so only the styled copy is
 * visible. The caret and selection are still the textarea's.
 *
 * The illusion holds on one condition: the mirror must lay out identically to
 * the textarea, character for character. That's why `highlightMarkdown` never
 * changes the text, why both elements share `.shortform-piece-textarea`'s
 * metrics, and why every `.md-*` class in globals.css is restricted to
 * styling that can't change a glyph's advance width (colour, opacity,
 * text-shadow) — a genuinely bold span would be wider than the plain text the
 * textarea laid out underneath, and the caret would drift off the glyphs.
 */
export function LiveMarkdownTextarea({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  onMouseDown,
  placeholder,
  readOnly,
  textareaRef,
  mirrorRef: externalMirrorRef,
}: LiveMarkdownTextareaProps) {
  const localMirrorRef = useRef<HTMLDivElement>(null);
  const mirrorRef = externalMirrorRef ?? localMirrorRef;

  // Match the mirror's scroll offset to the textarea's, for the rare case
  // where the textarea scrolls internally rather than growing.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    mirror.scrollTop = ta.scrollTop;
  }, [value, textareaRef]);

  function syncScroll() {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (ta && mirror) mirror.scrollTop = ta.scrollTop;
  }

  return (
    // Both children share one grid cell, rather than the mirror being
    // absolutely positioned: the taller of the two then sets the height, so a
    // sub-pixel disagreement between how a textarea and a div measure their
    // last line leaves a hair of space instead of clipping a descender.
    <div className="grid">
      <div
        ref={mirrorRef}
        aria-hidden
        className="shortform-piece-textarea shortform-piece-mirror col-start-1 row-start-1 w-full pointer-events-none select-none"
        // Safe: highlightMarkdown escapes every character of the source and
        // only ever emits its own <span class="md-*"> wrappers.
        dangerouslySetInnerHTML={{ __html: highlightMarkdown(value) }}
      />
      <textarea
        ref={textareaRef}
        data-piece-textarea
        tabIndex={-1}
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onScroll={syncScroll}
        readOnly={readOnly}
        placeholder={placeholder}
        className="shortform-piece-textarea shortform-piece-input col-start-1 row-start-1 w-full resize-none bg-transparent outline-none"
        rows={1}
      />
    </div>
  );
}
