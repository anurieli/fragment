"use client";

import type { ResolvedBriefField } from "@/lib/brief-context";

interface BriefFieldProps {
  label: string;
  /** This level's own value. Empty means "inherit", never "blank". */
  value: string;
  onChange: (value: string) => void;
  /** What the field falls back to when left empty (see lib/brief-context.ts). */
  inherited?: ResolvedBriefField;
  /** Name of the voice in play, for the "from …" hint. */
  voiceName?: string | null;
  /** Shown only when there is nothing to inherit either. */
  placeholder: string;
  rows?: number;
}

function sourceLabel(field: ResolvedBriefField, voiceName?: string | null): string {
  if (field.source === "voice") return voiceName ? `${voiceName} voice` : "your voice";
  if (field.source === "idea") return "this idea";
  return "";
}

/**
 * One field of a writing brief, showing what it inherits when it is empty.
 *
 * The inherited value is the input's placeholder rather than its value, which
 * is the whole trick: it reads as pre-filled, but nothing is written down, so
 * the field keeps following the tier above it until someone actually types.
 * Clearing the field is how you go back to inheriting. The same treatment the
 * voice picker already gives its "Default (…)" option.
 */
export function BriefField({
  label,
  value,
  onChange,
  inherited,
  voiceName,
  placeholder,
  rows,
}: BriefFieldProps) {
  const inheriting = !value.trim() && !!inherited?.value;
  const from = inherited && inheriting ? sourceLabel(inherited, voiceName) : "";
  const inputClass =
    "bg-transparent text-[13px] text-text-secondary placeholder:text-text-faint outline-none";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
          {label}
        </span>
        {from && (
          <span className="text-[9px] text-text-faint font-[family-name:var(--font-mono)] truncate">
            from {from}
          </span>
        )}
      </div>
      {rows ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={inherited?.value || placeholder}
          rows={rows}
          className={`${inputClass} resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={inherited?.value || placeholder}
          className={inputClass}
        />
      )}
    </div>
  );
}
