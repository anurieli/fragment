"use client";

import { useLayoutEffect, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";

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
  generatingTitle,
  onTitleChange,
  onSubtitleChange,
  onGenerateTitle,
  onFocusBody,
}: {
  title: string;
  subtitle: string;
  disabled?: boolean;
  /** True while the AI is writing a title: the button spins and stays visible. */
  generatingTitle?: boolean;
  onTitleChange: (title: string) => void;
  onSubtitleChange: (subtitle: string) => void;
  /** Omitted when there is nothing to title against (e.g. a version preview). */
  onGenerateTitle?: () => void;
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
    <div className="group max-w-[720px] mx-auto px-8 pt-14 pb-10">
      <div className="flex items-start gap-2">
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
        {onGenerateTitle && (
          <button
            type="button"
            onClick={onGenerateTitle}
            disabled={disabled || generatingTitle}
            title="Generate a title from this note"
            aria-label="Generate title"
            className={`mt-2.5 shrink-0 flex items-center justify-center w-8 h-8 rounded-[var(--radius-sm)] text-text-faint hover:text-gold hover:bg-gold/10 transition-all duration-150 disabled:hover:bg-transparent disabled:hover:text-text-faint ${
              generatingTitle ? "opacity-100 text-gold" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            {generatingTitle ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          </button>
        )}
      </div>
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
