"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Search, FileText, LayoutList } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { isLongformFormat } from "@/lib/content-engine";
import { formatDate } from "@/lib/utils";
import type { ContentPiece } from "@/lib/content-engine";

interface GlobalSearchProps {
  onClose: () => void;
}

interface FragmentResult {
  piece: ContentPiece;
  ideaTitle: string;
  /** Drives both the icon and where selecting the row lands you. */
  longform: boolean;
}

export function GlobalSearch({ onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);
  const setActivePiece = useAppStore((s) => s.setActivePiece);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // One index over one entity: every fragment keeps its own text, so a search
  // across the library is a search across pieces, drafts included.
  const results = useMemo<FragmentResult[]>(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return Object.values(pieces)
      .filter((p) => p.deletedAt === undefined)
      .filter(
        (p) =>
          (p.title ?? "").toLowerCase().includes(q) ||
          p.body.toLowerCase().includes(q),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20)
      .map((piece) => ({
        piece,
        ideaTitle: ideas[piece.ideaId]?.title || "Untitled idea",
        longform: isLongformFormat(piece.format),
      }));
  }, [query, pieces, ideas]);

  function getSnippet(content: string, q: string): string {
    const lower = content.toLowerCase();
    const idx = lower.indexOf(q.toLowerCase());
    if (idx === -1) return content.slice(0, 100);
    const start = Math.max(0, idx - 40);
    const end = Math.min(content.length, idx + q.length + 60);
    let snippet = content.slice(start, end).replace(/[#*_`>\-\[\]]/g, "");
    if (start > 0) snippet = "..." + snippet;
    if (end < content.length) snippet = snippet + "...";
    return snippet;
  }

  /** A draft opens in the editor with that exact fragment loaded; a short-form
   * piece opens its idea's feed, which is where a card is read and edited. */
  function handleSelect({ piece, longform }: FragmentResult) {
    setActiveIdea(piece.ideaId);
    if (longform) {
      setActivePiece(piece.id);
      setIdeaSpace(piece.ideaId, "write");
    } else {
      setIdeaSpace(piece.ideaId, "pieces");
    }
    onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-[520px] max-h-[60vh] bg-surface border border-border-strong rounded-[var(--radius-lg)] shadow-2xl overflow-hidden flex flex-col"
        style={{ animation: "fadeIn 0.12s ease-out" }}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search all drafts and pieces..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-faint outline-none"
          />
          <kbd className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] bg-surface-2 px-1.5 py-0.5 rounded-[3px] border border-border-strong">
            esc
          </kbd>
        </div>

        {/* Results, most recently edited first. Drafts carry the document
            icon, short-form pieces the feed icon. */}
        <div className="flex-1 overflow-y-auto">
          {query.trim() && results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-text-muted">Nothing matches &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            results.map((result) => {
              const { piece, ideaTitle, longform } = result;
              return (
                <button
                  key={piece.id}
                  onClick={() => handleSelect(result)}
                  className="flex items-start gap-3 w-full px-4 py-3 text-left hover:bg-surface-2 transition-colors duration-150 border-b border-border"
                >
                  {longform ? (
                    <FileText size={14} className="text-text-faint mt-0.5 shrink-0" />
                  ) : (
                    <LayoutList size={14} className="text-text-faint mt-0.5 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-text-primary truncate">
                        {piece.title || ideaTitle}
                      </span>
                      <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] shrink-0">
                        {formatDate(piece.updatedAt)}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">
                      {getSnippet(piece.body, query)}
                    </p>
                    <span className="text-[10px] text-text-faint">
                      {ideaTitle} · {longform ? "draft" : "piece"}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
