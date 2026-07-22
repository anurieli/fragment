"use client";

import { useEffect, useMemo, useState } from "react";
import { useVoiceStore, MAX_VOICES } from "@/stores/voice-store";
import { useSettingsStore } from "@/stores/settings-store";
import { VoiceList } from "./voice-list";
import { VoiceEditor } from "./voice-editor";

export function BrandVoiceSection() {
  const voicesMap = useVoiceStore((s) => s.voices);
  const addBrandVoice = useVoiceStore((s) => s.addBrandVoice);
  const defaultVoiceId = useSettingsStore((s) => s.settings.brandVoice.defaultVoiceId);

  const voices = useMemo(
    () => Object.values(voicesMap).sort((a, b) => a.createdAt - b.createdAt),
    [voicesMap],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Keep a valid selection: prefer the current one, else the default, else first.
  useEffect(() => {
    if (selectedId && voicesMap[selectedId]) return;
    setSelectedId(defaultVoiceId && voicesMap[defaultVoiceId] ? defaultVoiceId : voices[0]?.id ?? null);
  }, [selectedId, voicesMap, defaultVoiceId, voices]);

  const selectedVoice = selectedId ? voicesMap[selectedId] : null;

  const handleCreate = () => {
    const id = addBrandVoice({ name: "New voice" });
    if (id) setSelectedId(id);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-8 pt-8 pb-4 shrink-0">
        <h2 className="text-xl font-[family-name:var(--font-display)] text-text-primary mb-1">
          Brand Voice
        </h2>
        <p className="text-xs text-text-muted">
          Teach Fragment how you write. Create up to {MAX_VOICES} named voices from your own
          samples — every Flow, Refine, and new draft can sound like you.
        </p>
      </div>

      <div className="flex-1 flex min-h-0 border-t border-border">
        <VoiceList
          voices={voices}
          selectedId={selectedId}
          defaultVoiceId={defaultVoiceId}
          atCap={voices.length >= MAX_VOICES}
          onSelect={setSelectedId}
          onCreate={handleCreate}
        />

        <div className="flex-1 min-w-0">
          {selectedVoice ? (
            <VoiceEditor key={selectedVoice.id} voice={selectedVoice} />
          ) : (
            <div className="h-full flex items-center justify-center p-8 text-center">
              <div>
                <p className="text-sm text-text-secondary mb-1">No voices yet</p>
                <p className="text-xs text-text-faint max-w-[280px]">
                  Create your first Brand Voice to give Fragment&apos;s AI a consistent, personal
                  writing style.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
