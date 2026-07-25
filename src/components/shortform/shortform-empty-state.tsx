"use client";

import { Inbox } from "lucide-react";
import type { PieceFilter } from "./feed-logic";
import { EMPTY_STATE_COPY } from "./feed-logic";

interface ShortformEmptyStateProps {
  filter: PieceFilter;
}

/** One on-brand line per filter — no pieces match the current view. */
export function ShortformEmptyState({ filter }: ShortformEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-8">
      <Inbox size={22} className="mb-3 text-text-faint opacity-40" />
      <p className="text-[13px] text-text-muted max-w-[360px] leading-relaxed">
        {EMPTY_STATE_COPY[filter]}
      </p>
    </div>
  );
}
