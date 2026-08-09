"use client";

import { useState, useEffect } from "react";
import {
  getApiUsageStatsForPiece,
  onLogAdded,
  type PieceUsageStats,
} from "@/lib/api-logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const val = n / 1_000_000;
    return `${parseFloat(val.toFixed(1))}M`;
  }
  if (n >= 1_000) {
    const val = n / 1_000;
    return `${parseFloat(val.toFixed(1))}k`;
  }
  return String(n);
}

function formatCost(n: number): string {
  if (n === 0) return "$0.00";
  // For costs >= $0.01, show two decimal places
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  // For tiny costs, show enough precision to be meaningful
  return `$${n.toFixed(4)}`;
}

const ROUTE_LABELS: Record<string, string> = {
  generate: "Flow",
  edit: "Refine",
  label: "Snip",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PieceUsageFooterProps {
  pieceId: string;
}

export function PieceUsageFooter({ pieceId }: PieceUsageFooterProps) {
  const [stats, setStats] = useState<PieceUsageStats | null>(null);

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      getApiUsageStatsForPiece(pieceId).then((s) => {
        if (!cancelled) setStats(s);
      });
    }

    refresh();

    const unsubscribe = onLogAdded(refresh);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [pieceId]);

  if (!stats || stats.totalCalls === 0) return null;

  const parts: string[] = [];

  for (const [route, label] of Object.entries(ROUTE_LABELS)) {
    const count = stats.callsByRoute[route as keyof typeof stats.callsByRoute];
    if (count > 0) {
      parts.push(`${label}: ${count}`);
    }
  }

  parts.push(`${formatTokens(stats.totalTokens)} tokens`);
  parts.push(formatCost(stats.totalCost));

  return (
    <div className="shrink-0 border-t border-[var(--color-surface-3)] px-8 py-1.5">
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-faint)] font-[family-name:var(--font-mono)]">
        {parts.map((part, i) => (
          <span key={part}>
            {i > 0 && <span className="mx-0.5">·</span>}
            {part}
          </span>
        ))}
      </div>
    </div>
  );
}
