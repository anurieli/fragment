"use client";

import { useLayoutEffect, useRef } from "react";

/** Auto-grow a textarea to fit its content (no scrollbar, no manual resize). */
function autoGrow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "0";
  el.style.height = `${el.scrollHeight}px`;
}

/**
 * Fixed-format document header rendered above the article body.
 * Title and subtitle always look the same — they live outside the
 * markdown document, so no editor formatting can touch them.
 */
export function NoteHeader({
  title,
  subtitle,
  disabled,
  onTitleChange,
  onSubtitleChange,
  onFocusBody,
}: {
  title: string;
  subtitle: string;
  disabled?: boolean;
  onTitleChange: (title: string) => void;
  onSubtitleChange: (subtitle: string) => void;
  onFocusBody: () => void;
}) {
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const subtitleRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    autoGrow(titleRef.current);
  }, [title]);

  useLayoutEffect(() => {
    autoGrow(subtitleRef.current);
  }, [subtitle]);

  return (
    <div className="max-w-[720px] mx-auto px-8 pt-14 pb-10">
      <textarea
        ref={titleRef}
        rows={1}
        value={title}
        disabled={disabled}
        onChange={(e) => onTitleChange(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            subtitleRef.current?.focus();
          }
        }}
        placeholder="Untitled"
        className="block w-full resize-none overflow-hidden bg-transparent outline-none caret-gold font-[family-name:var(--font-display)] text-[2.5rem] leading-[1.15] text-text-primary placeholder:text-text-faint disabled:opacity-60"
      />
      <textarea
        ref={subtitleRef}
        rows={1}
        value={subtitle}
        disabled={disabled}
        onChange={(e) => onSubtitleChange(e.target.value.replace(/\n/g, " "))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onFocusBody();
          }
        }}
        placeholder="Add a subtitle…"
        className="mt-3 block w-full resize-none overflow-hidden bg-transparent outline-none caret-gold font-[family-name:var(--font-display)] text-[1.25rem] leading-[1.45] text-text-muted placeholder:text-text-faint disabled:opacity-60"
      />
    </div>
  );
}
