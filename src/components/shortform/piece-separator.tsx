"use client";

import { useState } from "react";
import { useAppStore } from "@/stores/app-store";

interface PieceSeparatorProps {
  ideaId: string;
  /** Where a piece dropped on this separator should sort — a value between
   * its neighbors' `order` (see shortform-feed.tsx for how this is derived).
   * Read off `data-insert-order` by the snippet card's custom drag-drop
   * handler (see snippet-card.tsx), the same pattern the Snip Bar's
   * `data-snip-bar-drop-zone` / `data-drop-index` pair already uses. */
  insertOrder: number;
}

/**
 * A warm hairline between pieces. Doubles as a Snip Bar drop target: dragging
 * a snippet card here (see the drag bridge in snippet-card.tsx) creates a new
 * piece at this position. Thickens to a 2px gold line while a snippet is
 * being dragged over it.
 */
export function PieceSeparator({ ideaId, insertOrder }: PieceSeparatorProps) {
  const isDraggingSnippet = useAppStore((s) => s.isDraggingToEditor);
  const [hover, setHover] = useState(false);
  const active = isDraggingSnippet && hover;

  return (
    <div
      data-piece-separator
      data-idea-id={ideaId}
      data-insert-order={insertOrder}
      onMouseEnter={() => { if (isDraggingSnippet) setHover(true); }}
      onMouseLeave={() => setHover(false)}
      className="relative flex items-center px-5"
      style={{ height: active ? 14 : 10 }}
    >
      <div
        className={`w-full rounded-full transition-all duration-100 ${
          active ? "h-[2px] bg-gold" : "h-px bg-[var(--color-border)]"
        }`}
      />
    </div>
  );
}
