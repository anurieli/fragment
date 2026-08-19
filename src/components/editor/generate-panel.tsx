"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Mic, Square } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { useSpeechDictation } from "@/hooks/use-speech-dictation";
import { ModelSelector } from "@/components/settings/model-selector";
import { useFeatureProvider } from "@/hooks/use-feature-provider";
import type { GenerateFormat, GenerateLength } from "@/lib/defaults";
import type { ResolvedBrief } from "@/lib/brief-context";
import { BriefField } from "./brief-field";

/** Everything the panel collects; the caller turns it into a generation run. */
export interface GeneratePanelSubmit {
  prompt: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  /** undefined = inherit default voice, null = explicitly none, string = voice id. */
  voiceId?: string | null;
  format: GenerateFormat;
  length: GenerateLength;
}

interface GeneratePanelProps {
  /** Compact variant for the inline empty-fragment surface: tighter spacing,
   * context fields collapsed by default. The full variant (creation flow)
   * shows context fields expanded. */
  compact?: boolean;
  /** Prefill for context fields, e.g. from the fragment being written into. */
  initial?: Partial<Pick<GeneratePanelSubmit, "goal" | "audience" | "tone" | "remember" | "voiceId">>;
  /** What each field falls back to when left blank — shown as its placeholder
   * so the panel reads as pre-filled without writing anything down. */
  inherited?: ResolvedBrief;
  /** Name of the voice the inherited values came from. */
  voiceName?: string | null;
  onGenerate: (params: GeneratePanelSubmit) => void;
  onCancel?: () => void;
  onOpenAISettings?: () => void;
}

const FORMAT_OPTIONS: { value: GenerateFormat; label: string }[] = [
  { value: "freeform", label: "Freeform" },
  { value: "essay", label: "Essay" },
  { value: "blog", label: "Blog post" },
  { value: "newsletter", label: "Newsletter" },
  { value: "script", label: "Script" },
];

const LENGTH_OPTIONS: { value: GenerateLength; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "short", label: "Short" },
  { value: "medium", label: "Medium" },
  { value: "long", label: "Long" },
];

export function GeneratePanel({ compact, initial, inherited, voiceName, onGenerate, onCancel, onOpenAISettings }: GeneratePanelProps) {
  const settings = useSettingsStore((s) => s.settings);
  const updateFeatureProvider = useSettingsStore((s) => s.updateFeatureProvider);
  const voicesMap = useVoiceStore((s) => s.voices);
  const voicesList = Object.values(voicesMap).sort((a, b) => a.createdAt - b.createdAt);

  const [prompt, setPrompt] = useState("");
  const [format, setFormat] = useState<GenerateFormat>("freeform");
  const [length, setLength] = useState<GenerateLength>("auto");
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [audience, setAudience] = useState(initial?.audience ?? "");
  const [tone, setTone] = useState(initial?.tone ?? "");
  const [remember, setRemember] = useState(initial?.remember ?? "");
  const [voiceId, setVoiceId] = useState<string | null | undefined>(initial?.voiceId);
  const [contextExpanded, setContextExpanded] = useState(!compact);

  const dictation = useSpeechDictation(
    useCallback((text: string) => {
      setPrompt((prev) => (prev ? `${prev.trimEnd()} ${text}` : text));
    }, []),
  );

  const handleGenerate = useCallback(() => {
    if (!prompt.trim()) return;
    if (dictation.listening) dictation.stop();
    onGenerate({ prompt: prompt.trim(), goal, audience, tone, remember, voiceId, format, length });
  }, [prompt, goal, audience, tone, remember, voiceId, format, length, onGenerate, dictation]);

  const featureConfig = useFeatureProvider("slashCommand");

  return (
    <div>
      {/* Prompt textarea with dictation */}
      <div className="relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g., A blog post about why most productivity advice is wrong, aimed at startup founders... or hit the mic and brain-dump it out loud."
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && prompt.trim()) {
              handleGenerate();
            }
          }}
          className={`w-full ${compact ? "min-h-[90px] p-3 pb-9 text-[13px]" : "min-h-[120px] p-4 pb-10 text-[14px]"}
            bg-surface-2 border border-border-strong rounded-[var(--radius-lg)]
            text-text-primary placeholder:text-text-faint
            resize-y outline-none focus:border-border-active transition-colors duration-150`}
        />
        {dictation.supported && (
          <button
            onClick={dictation.toggle}
            title={dictation.listening ? "Stop dictating" : "Dictate: talk instead of typing"}
            className={`absolute bottom-3 right-2.5 flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px]
              transition-all duration-150 ${
                dictation.listening
                  ? "bg-red-500/15 text-red-400 border border-red-500/30"
                  : "text-text-faint hover:text-text-secondary hover:bg-surface-3 border border-transparent"
              }`}
          >
            {dictation.listening ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                Listening
                <Square size={9} className="ml-0.5" />
              </>
            ) : (
              <Mic size={12} />
            )}
          </button>
        )}
      </div>

      {/* Format + length */}
      <div className={`${compact ? "mt-2 space-y-1.5" : "mt-3 space-y-2"}`}>
        <ChipRow
          label="Format"
          options={FORMAT_OPTIONS}
          value={format}
          onChange={setFormat}
        />
        <ChipRow
          label="Length"
          options={LENGTH_OPTIONS}
          value={length}
          onChange={setLength}
        />
      </div>

      {/* Context fields */}
      <div className={compact ? "mt-2.5" : "mt-3.5"}>
        <button
          onClick={() => setContextExpanded(!contextExpanded)}
          className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors duration-150"
        >
          {contextExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Context
          <span className="text-text-faint">goal, audience, tone{voicesList.length > 0 ? ", voice" : ""}</span>
        </button>
        {contextExpanded && (
          <div
            className="mt-2 space-y-3 p-3 bg-surface-2 border border-border-strong rounded-[var(--radius-default)]"
            style={{ animation: "fadeIn 0.15s ease-out" }}
          >
            <p className="text-[10px] text-text-faint leading-relaxed">
              Helps the AI write a better first draft. Blank means it uses what
              your idea and your voice already say. You can edit these later in
              the toolbar.
            </p>
            <BriefField label="Goal" value={goal} onChange={setGoal} inherited={inherited?.goal} voiceName={voiceName} placeholder="What are you writing about?" />
            <BriefField label="Audience" value={audience} onChange={setAudience} inherited={inherited?.audience} voiceName={voiceName} placeholder="Who is this for?" />
            <BriefField label="Tone" value={tone} onChange={setTone} inherited={inherited?.tone} voiceName={voiceName} placeholder="e.g. conversational, formal, witty..." />
            <BriefField label="Remember" value={remember} onChange={setRemember} inherited={inherited?.remember} voiceName={voiceName} placeholder="Things the AI should keep in mind..." />
            {voicesList.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
                  Voice
                </label>
                <select
                  value={voiceId === null ? "__none__" : voiceId === undefined ? "__default__" : voiceId}
                  onChange={(e) => {
                    const v = e.target.value;
                    setVoiceId(v === "__default__" ? undefined : v === "__none__" ? null : v);
                  }}
                  className="bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1 text-[13px] text-text-secondary outline-none focus:border-border-active"
                >
                  <option value="__default__">
                    Default{settings.brandVoice.defaultVoiceId && voicesMap[settings.brandVoice.defaultVoiceId] ? ` (${voicesMap[settings.brandVoice.defaultVoiceId].name})` : ""}
                  </option>
                  <option value="__none__">No voice</option>
                  {voicesList.map((v) => (
                    <option key={v.id} value={v.id}>{v.name || "Untitled voice"}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Model row: shared with Flow, edited in place */}
      <div className={`flex items-center gap-2 ${compact ? "mt-2.5" : "mt-3.5"}`}>
        <div className="flex-1 min-w-0 max-w-[260px]">
          <ModelSelector
            value={featureConfig.model}
            provider={featureConfig.provider}
            onChange={(model) =>
              updateFeatureProvider("slashCommand", { provider: featureConfig.provider, model })
            }
          />
        </div>
        {onOpenAISettings && (
          <button
            onClick={onOpenAISettings}
            className="shrink-0 text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150"
            title="Provider, prompt template, and more"
          >
            AI settings
          </button>
        )}
      </div>

      {/* Actions */}
      <div className={`flex justify-end gap-2 ${compact ? "mt-3" : "mt-4"}`}>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-[var(--radius-default)] text-[13px] text-text-muted hover:text-text-secondary transition-colors duration-150"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim()}
          className="px-4 py-2 rounded-[var(--radius-default)] text-[13px] font-medium
            bg-gold/10 border border-gold/20 text-gold
            hover:bg-gold/20 disabled:opacity-40 disabled:cursor-not-allowed
            transition-all duration-150"
        >
          Generate draft
        </button>
      </div>
    </div>
  );
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 rounded-full text-[11px] border transition-all duration-150 ${
              opt.value === value
                ? "bg-gold/10 border-gold/30 text-gold"
                : "border-border-strong text-text-muted hover:text-text-secondary hover:bg-surface-2"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

