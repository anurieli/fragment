"use client";

import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import type { BrandVoice } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { analyzeVoice } from "@/hooks/use-analyze-voice";

interface VoiceProfileCardProps {
  voice: BrandVoice;
}

export function VoiceProfileCard({ voice }: VoiceProfileCardProps) {
  const status = useAppStore((s) => s.voiceAnalysisStatus[voice.id]);
  const analyzing = status === "analyzing";
  const profile = voice.profile;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider">
          Voice Profile
        </label>
        <button
          onClick={() => analyzeVoice(voice.id)}
          disabled={analyzing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-gold/15 border border-gold/30 text-[11px] text-gold hover:bg-gold/25 transition-colors duration-150 disabled:opacity-50"
        >
          {analyzing ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {analyzing ? "Analyzing…" : profile ? "Re-analyze" : "Analyze voice"}
        </button>
      </div>
      <p className="text-[10px] text-text-faint mb-3">
        A compact summary of your voice, injected into every generation. Re-analyze after
        changing your samples or description.
      </p>

      {voice.profileStale && profile && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[var(--radius-sm)] bg-amber-500/10 border border-amber-500/25">
          <AlertTriangle size={13} className="text-amber-400 shrink-0" />
          <span className="text-[11px] text-amber-300">
            Samples or description changed since the last analysis. Re-analyze to refresh the profile.
          </span>
        </div>
      )}

      {!profile ? (
        <div className="rounded-[var(--radius-default)] border border-dashed border-border-strong p-6 text-center">
          <p className="text-xs text-text-muted mb-1">No profile yet</p>
          <p className="text-[11px] text-text-faint">
            Your voice already works from its description. Analyze samples to make generations
            match it far more closely.
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--radius-default)] border border-border-strong bg-surface-2 p-4 space-y-4">
          {profile.summary && (
            <p className="text-xs text-text-secondary leading-relaxed">{profile.summary}</p>
          )}

          {profile.traits.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {profile.traits.map((trait, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-full bg-surface-3 border border-border text-[10px] text-text-secondary"
                >
                  {trait}
                </span>
              ))}
            </div>
          )}

          {profile.exampleExcerpts.length > 0 && (
            <div>
              <p className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
                Example excerpts
              </p>
              <ul className="space-y-1.5">
                {profile.exampleExcerpts.map((ex, i) => (
                  <li
                    key={i}
                    className="text-[11px] text-text-muted italic border-l-2 border-border-strong pl-2.5 leading-relaxed"
                  >
                    “{ex}”
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(profile.doGuidance.length > 0 || profile.dontGuidance.length > 0) && (
            <div className="grid grid-cols-2 gap-4">
              {profile.doGuidance.length > 0 && (
                <div>
                  <p className="text-[10px] text-emerald-400/80 font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
                    Do
                  </p>
                  <ul className="space-y-1">
                    {profile.doGuidance.map((d, i) => (
                      <li key={i} className="text-[11px] text-text-muted leading-snug">• {d}</li>
                    ))}
                  </ul>
                </div>
              )}
              {profile.dontGuidance.length > 0 && (
                <div>
                  <p className="text-[10px] text-red-400/80 font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
                    Don&apos;t
                  </p>
                  <ul className="space-y-1">
                    {profile.dontGuidance.map((d, i) => (
                      <li key={i} className="text-[11px] text-text-muted leading-snug">• {d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
