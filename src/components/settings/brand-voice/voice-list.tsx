"use client";

import { Plus, Circle } from "lucide-react";
import type { BrandVoice } from "@/lib/types";

interface VoiceListProps {
  voices: BrandVoice[];
  selectedId: string | null;
  defaultVoiceId: string | null;
  atCap: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function VoiceList({
  voices,
  selectedId,
  defaultVoiceId,
  atCap,
  onSelect,
  onCreate,
}: VoiceListProps) {
  return (
    <div className="w-[240px] shrink-0 border-r border-border h-full overflow-y-auto p-4">
      <div className="space-y-1.5 mb-3">
        {voices.map((voice) => {
          const isSelected = voice.id === selectedId;
          const isDefault = voice.id === defaultVoiceId;
          return (
            <button
              key={voice.id}
              onClick={() => onSelect(voice.id)}
              className={`w-full text-left px-3 py-2.5 rounded-[var(--radius-lg)] border transition-all duration-150 ${
                isSelected
                  ? "bg-surface-3 border-border-strong"
                  : "bg-transparent border-transparent hover:bg-surface-2"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-[13px] text-text-primary">
                  {voice.name || "Untitled voice"}
                </span>
                {voice.profileStale && (
                  <Circle size={7} className="fill-amber-400 text-amber-400 shrink-0" aria-label="Needs re-analysis" />
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {isDefault && (
                  <span className="text-[9px] uppercase tracking-wider text-gold font-[family-name:var(--font-mono)]">
                    Default
                  </span>
                )}
                <span className="text-[10px] text-text-faint">
                  {voice.profile ? "Analyzed" : "Not analyzed"}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <button
        onClick={onCreate}
        disabled={atCap}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-[var(--radius-lg)] border border-dashed border-border-strong text-[12px] text-text-muted hover:text-text-secondary hover:border-border-active transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Plus size={13} />
        New voice
      </button>
      {atCap && (
        <p className="text-[10px] text-text-faint mt-1.5 text-center">
          You can have up to 5 voices. Delete one to add another.
        </p>
      )}
    </div>
  );
}
