"use client";

import { useCallback, useState } from "react";
import { Star, Trash2 } from "lucide-react";
import type { BrandVoice } from "@/lib/types";
import { useVoiceStore } from "@/stores/voice-store";
import { useSettingsStore } from "@/stores/settings-store";
import { VoiceSamplesManager } from "./voice-samples-manager";
import { VoiceProfileCard } from "./voice-profile-card";

interface VoiceEditorProps {
  voice: BrandVoice;
}

const FIELD_CLASS =
  "w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-secondary font-[family-name:var(--font-body)] leading-relaxed outline-none focus:border-border-active transition-colors duration-150 placeholder:text-text-faint";

export function VoiceEditor({ voice }: VoiceEditorProps) {
  const updateBrandVoice = useVoiceStore((s) => s.updateBrandVoice);
  const deleteBrandVoice = useVoiceStore((s) => s.deleteBrandVoice);
  const setDefaultVoice = useVoiceStore((s) => s.setDefaultVoice);
  const defaultVoiceId = useSettingsStore((s) => s.settings.brandVoice.defaultVoiceId);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDefault = defaultVoiceId === voice.id;

  // Editing samples or the description invalidates the distilled profile.
  const markStale = useCallback(() => {
    updateBrandVoice(voice.id, { profileStale: true });
  }, [voice.id, updateBrandVoice]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-8 max-w-[640px] mx-auto">
        {/* Name */}
        <div className="mb-6">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
            Voice Name
          </label>
          <input
            type="text"
            value={voice.name}
            onChange={(e) => updateBrandVoice(voice.id, { name: e.target.value })}
            placeholder="My voice"
            className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-sm text-text-primary outline-none focus:border-border-active transition-colors duration-150 placeholder:text-text-faint"
          />
        </div>

        {/* Description */}
        <div className="mb-8">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
            Description
          </label>
          <textarea
            value={voice.description}
            onChange={(e) => {
              updateBrandVoice(voice.id, { description: e.target.value, profileStale: true });
            }}
            placeholder={`Describe how this voice sounds. For example:\n\n"Conversational and direct. Short paragraphs, rhetorical questions, grounded in concrete examples."`}
            rows={5}
            className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-secondary font-[family-name:var(--font-body)] leading-relaxed outline-none focus:border-border-active transition-colors duration-150 resize-y placeholder:text-text-faint"
          />
          <p className="text-[10px] text-text-faint mt-1.5">
            Used as context on its own, and as guidance for the analysis. This voice works from
            minute one, even before you analyze samples.
          </p>
        </div>

        <VoiceSamplesManager voiceId={voice.id} onSamplesChanged={markStale} />

        <VoiceProfileCard voice={voice} />

        {/* Structure guide (template) */}
        <div className="mb-8">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
            Structure Guide
          </label>
          <textarea
            value={voice.template}
            onChange={(e) => updateBrandVoice(voice.id, { template: e.target.value })}
            placeholder={`Optional. How should pieces in this voice be structured?\n\n"Open with a hook. One idea per paragraph. End with a concrete takeaway."`}
            rows={4}
            className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-secondary font-[family-name:var(--font-body)] leading-relaxed outline-none focus:border-border-active transition-colors duration-150 resize-y placeholder:text-text-faint"
          />
          <p className="text-[10px] text-text-faint mt-1.5">
            Injected verbatim into generations. This is guidance, not a template you fill in.
          </p>
        </div>

        {/* Default brief. A voice is a persona, so it already implies who it
            speaks to and how it sounds; ideas and pieces inherit these
            until they say otherwise (see lib/brief-context.ts). No goal here:
            what a given piece is trying to achieve is the piece's business. */}
        <div className="mb-8">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
            Default Brief
          </label>
          <div className="space-y-2">
            <input
              type="text"
              value={voice.defaultAudience ?? ""}
              onChange={(e) => updateBrandVoice(voice.id, { defaultAudience: e.target.value })}
              placeholder="Audience — who this voice is talking to"
              className={FIELD_CLASS}
            />
            <input
              type="text"
              value={voice.defaultTone ?? ""}
              onChange={(e) => updateBrandVoice(voice.id, { defaultTone: e.target.value })}
              placeholder="Tone — e.g. direct, plain, no hype"
              className={FIELD_CLASS}
            />
            <textarea
              value={voice.defaultRemember ?? ""}
              onChange={(e) => updateBrandVoice(voice.id, { defaultRemember: e.target.value })}
              placeholder="Remember — things the AI should always keep in mind in this voice"
              rows={2}
              className={`${FIELD_CLASS} resize-y`}
            />
          </div>
          <p className="text-[10px] text-text-faint mt-1.5">
            Every idea and piece using this voice starts here. Change one on a
            piece and only that piece detaches; change it here and everything that
            never overrode it follows.
          </p>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <button
            onClick={() => setDefaultVoice(voice.id)}
            disabled={isDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-surface-3 border border-border-strong text-[11px] text-text-secondary hover:text-text-primary hover:border-border-active transition-colors duration-150 disabled:opacity-50 disabled:cursor-default"
          >
            <Star size={12} className={isDefault ? "fill-gold text-gold" : ""} />
            {isDefault ? "Default voice" : "Make default"}
          </button>

          {confirmDelete ? (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-text-muted">
                Pieces using this voice fall back to your default voice.
              </span>
              <button
                onClick={() => deleteBrandVoice(voice.id)}
                className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-red-500/15 border border-red-500/30 text-[11px] text-red-400 hover:bg-red-500/25 transition-colors duration-150"
              >
                Delete
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] text-text-muted hover:text-text-secondary transition-colors duration-150"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] text-text-muted hover:text-red-400 transition-colors duration-150"
            >
              <Trash2 size={12} />
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
