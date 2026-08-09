"use client";

import { useMemo } from "react";
import { PenLine, LayoutList } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { hierarchyRollup, shortformOnly } from "@/stores/content-selectors";

interface SpaceToggleProps {
  ideaId: string;
}

/**
 * Segmented "Write | Pieces" control. Write = the existing long-form editor,
 * Pieces = the short-form feed for this idea (and its rolled-up children).
 * The stored space value stays "pieces": it is an identifier, not copy.
 * Lives at the left of the center-panel toolbar whenever an idea is active —
 * mirrors the showSettings center-swap precedent in app-shell.tsx, just one
 * level down (idea-scoped instead of app-scoped). ⌘1/⌘2 switch (wired in
 * app-shell's keydown handler); the choice persists per idea for the
 * session.
 */
export function SpaceToggle({ ideaId }: SpaceToggleProps) {
  const space = useAppStore((s) => s.ideaSpaces[ideaId] ?? "write");
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);

  const hasUnseen = useMemo(() => {
    const rolled = shortformOnly(
      hierarchyRollup(ideaId, Object.values(ideas), Object.values(pieces)),
    );
    return rolled.some((p) => !p.seen);
  }, [ideaId, ideas, pieces]);

  return (
    <div
      className="inline-flex items-center gap-0.5 p-0.5 rounded-[var(--radius-default)] bg-surface-2 border border-border shrink-0"
      title="Write is the long-form editor. Pieces is the short-form feed for this idea."
    >
      <button
        onClick={() => setIdeaSpace(ideaId, "write")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium transition-all duration-150 ${
          space === "write"
            ? "bg-surface-3 text-text-primary"
            : "text-text-muted hover:text-text-secondary"
        }`}
      >
        <PenLine size={12} />
        Write
      </button>
      <button
        onClick={() => setIdeaSpace(ideaId, "pieces")}
        className={`relative flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium transition-all duration-150 ${
          space === "pieces"
            ? "bg-surface-3 text-text-primary"
            : "text-text-muted hover:text-text-secondary"
        }`}
      >
        <LayoutList size={12} />
        Pieces
        {hasUnseen && (
          <span
            className="w-1.5 h-1.5 rounded-full bg-gold"
            style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
          />
        )}
      </button>
    </div>
  );
}
