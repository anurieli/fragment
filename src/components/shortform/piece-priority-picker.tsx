"use client";

import { Flag } from "lucide-react";
import type { Priority } from "@/lib/content-engine";
import { PRIORITY_OPTIONS } from "@/lib/priority";

interface PriorityFlagPickerProps {
  /** `null` means a bulk selection has mixed priorities, so nothing is marked current. */
  priority: Priority | null;
  onSelect: (priority: Priority) => void;
  hint?: string;
}

/**
 * Keeps every priority choice visible in the piece menu. Priority is a quick
 * triage signal, so choosing it should take one click rather than opening a
 * second disclosure and scanning a text list. A mixed bulk selection leaves
 * every option unpressed until the user deliberately applies one value.
 */
export function PriorityFlagPicker({ priority, onSelect, hint }: PriorityFlagPickerProps) {
  return (
    <div className="border-t border-border px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
          Priority
        </span>
        {hint && <span className="truncate text-[10px] text-text-faint">{hint}</span>}
      </div>
      <div role="group" aria-label="Priority" className="flex items-center justify-between gap-1">
        {PRIORITY_OPTIONS.map((option) => {
          const selected = priority === option.value;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={option.label}
              aria-pressed={selected}
              title={option.label}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(option.value);
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border transition-all duration-150 ${
                selected
                  ? "border-current bg-surface-hover"
                  : "border-transparent hover:border-current hover:bg-surface-hover"
              } ${option.className}`}
            >
              <Flag size={14} fill="currentColor" strokeWidth={option.value === 1 ? 2.5 : 2} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
