"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Search, FileText } from "lucide-react";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { formatDate } from "@/lib/utils";

interface GlobalSearchProps {
  onClose: () => void;
}

export function GlobalSearch({ onClose }: GlobalSearchProps) {
  const [query, setQuery] = useState("");
  const notes = useDataStore((s) => s.notes);
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.toLowerCase();
    return Object.values(notes)
      .filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q),
      )
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
  }, [query, notes]);

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

  function handleSelect(noteId: string) {
    setActiveNote(noteId);
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
            placeholder="Search all notes..."
            className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-faint outline-none"
          />
          <kbd className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] bg-surface-2 px-1.5 py-0.5 rounded-[3px] border border-border-strong">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {query.trim() && results.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-xs text-text-muted">No notes match &ldquo;{query}&rdquo;</p>
            </div>
          ) : (
            results.map((note) => (
              <button
                key={note.id}
                onClick={() => handleSelect(note.id)}
                className="flex items-start gap-3 w-full px-4 py-3 text-left hover:bg-surface-2 transition-colors duration-150 border-b border-border"
              >
                <FileText size={14} className="text-text-faint mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-text-primary truncate">
                      {note.title || "Untitled"}
                    </span>
                    <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] shrink-0">
                      {formatDate(note.updatedAt)}
                    </span>
                  </div>
                  <p className="text-[11px] text-text-muted mt-0.5 line-clamp-2">
                    {getSnippet(note.content, query)}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
