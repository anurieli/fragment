"use client";

import { Plus } from "lucide-react";
import type { PieceFilter, PieceFilterCounts, PieceSortMode } from "./feed-logic";
import { PIECE_FILTERS } from "./feed-logic";

const FILTER_LABELS: Record<PieceFilter, string> = {
  all: "All",
  inbox: "Inbox",
  "in-progress": "In progress",
  ready: "Ready",
};

const SORT_OPTIONS: { value: PieceSortMode; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "priority", label: "Priority" },
  { value: "last-edited", label: "Last edited" },
  { value: "schedule", label: "Schedule" },
  { value: "manual", label: "Manual" },
];

interface PieceFilterBarProps {
  filter: PieceFilter;
  onFilterChange: (filter: PieceFilter) => void;
  counts: PieceFilterCounts;
  sort: PieceSortMode;
  onSortChange: (sort: PieceSortMode) => void;
  onNewPiece: () => void;
}

/**
 * Instant client-side filter chips over one list of pieces, plus a sort
 * control and "+ New piece". Numbers 1-4 (see shortform-view.tsx's keydown
 * handler) jump straight to a filter, in this same left-to-right order.
 */
export function PieceFilterBar({
  filter,
  onFilterChange,
  counts,
  sort,
  onSortChange,
  onNewPiece,
}: PieceFilterBarProps) {
  return (
    <div className="flex items-center gap-2 px-8 pt-2 pb-3 shrink-0">
      <div className="flex items-center gap-1">
        {PIECE_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] text-[10px] uppercase tracking-wider font-[family-name:var(--font-mono)] font-medium transition-all duration-150 ${
              filter === f
                ? "text-gold bg-gold-muted"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
            }`}
          >
            {FILTER_LABELS[f]}
            <span className={filter === f ? "text-gold/70" : "text-text-faint"}>{counts[f]}</span>
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as PieceSortMode)}
          title="Sort pieces"
          className="bg-surface-2 border border-border rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-text-secondary outline-none focus:border-border-active cursor-pointer"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <button
          onClick={onNewPiece}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium text-text-secondary bg-surface-2 border border-border-strong hover:bg-surface-3 hover:text-text-primary hover:border-gold/20 transition-all duration-150"
        >
          <Plus size={12} />
          New piece
        </button>
      </div>
    </div>
  );
}
