"use client";

import { useCallback, useRef, useState } from "react";
import {
  FileText,
  ClipboardPaste,
  Upload,
  Sparkles,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { getProviderKey } from "@/lib/ai/provider-runtime";
import { generateId } from "@/lib/utils";
import { saveSamples } from "@/lib/persistence";
import { extractSampleText, SAMPLE_ACCEPT } from "@/lib/sample-extract";
import { analyzeVoice } from "@/hooks/use-analyze-voice";
import { useDeviceId } from "@/hooks/use-device-id";
import { useToastStore } from "@/hooks/use-toast";
import { identify } from "@/lib/convex-client";
import type { VoiceSample } from "@/lib/types";
import { hasWorkingProvider, hasAnyProviderPresent } from "@/lib/ai/connection-status";
import { isHosted } from "@/lib/edition";
import { ConnectPanel } from "@/components/ai-connect/connect-panel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OnboardingFlowProps {
  onComplete: () => void;
}

type Step1View = "grid" | "paste" | "generate";

// ─── Demo area (video + schematic fallback) ───────────────────────────────────

interface DemoAreaProps {
  src: string;
  fallback: React.ReactNode;
}

function DemoArea({ src, fallback }: DemoAreaProps) {
  // The animated schematic is always the base layer. If a real video clip is
  // present at `src` and can actually play, it cross-fades in over the top.
  // When `src` is empty (no clip rendered yet) we never request a file, so the
  // animated schematic is the motion graphic.
  const [videoReady, setVideoReady] = useState(false);
  const hasVideo = Boolean(src);

  return (
    <div className="w-full rounded-[var(--radius-lg)] bg-surface-2 border border-border-strong overflow-hidden relative"
      style={{ height: 240 }}>
      <div
        className="absolute inset-0 transition-opacity duration-300"
        style={{ opacity: videoReady ? 0 : 1 }}
      >
        {fallback}
      </div>
      {hasVideo && (
        <video
          key={src}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: videoReady ? 1 : 0 }}
          autoPlay
          loop
          muted
          playsInline
          onCanPlay={() => setVideoReady(true)}
          onError={() => setVideoReady(false)}
        >
          <source src={src} type="video/mp4" />
        </video>
      )}
    </div>
  );
}

// ─── Schematics ───────────────────────────────────────────────────────────────

function SnipSchematic() {
  return (
    <div className="w-full h-full flex items-stretch gap-1.5 p-3">
      {/* Editor panel */}
      <div className="flex-1 bg-surface rounded-[var(--radius-sm)] border border-border-strong p-3 flex flex-col gap-1.5 overflow-hidden">
        <div className="h-1.5 w-3/4 bg-surface-3 rounded-full" />
        <div className="h-1.5 w-full bg-surface-3 rounded-full" />
        {/* Gold selection highlight */}
        <div
          className="rounded px-1 py-0.5"
          style={{ background: "var(--color-gold-muted)", border: "1px solid var(--color-gold-strong)" }}
        >
          <div className="h-1.5 w-4/5 rounded-full anim-snip-select" style={{ background: "var(--color-gold)", opacity: 0.6 }} />
        </div>
        <div className="h-1.5 w-full bg-surface-3 rounded-full" />
        <div className="h-1.5 w-2/3 bg-surface-3 rounded-full" />
      </div>

      {/* Arrow */}
      <div className="flex items-center">
        <ChevronRight size={14} className="text-gold opacity-60 anim-snip-arrow" />
      </div>

      {/* Snip bar panel */}
      <div className="w-[110px] bg-surface rounded-[var(--radius-sm)] border border-border-strong p-2 flex flex-col gap-1.5">
        <div className="text-[8px] font-[family-name:var(--font-mono)] text-text-faint uppercase tracking-wider mb-0.5">
          Snip Bar
        </div>
        {/* Snippet cards */}
        {[70, 55, 80].map((w, i) => (
          <div
            key={i}
            className={`rounded px-2 py-1.5 border ${i === 0 ? "anim-snip-card" : ""}`}
            style={{
              background: i === 0 ? "var(--color-gold-muted)" : "var(--color-surface-3)",
              borderColor: i === 0 ? "var(--color-gold-strong)" : "var(--color-border-strong)",
            }}
          >
            <div
              className="h-1 rounded-full"
              style={{
                width: `${w}%`,
                background: i === 0 ? "var(--color-gold)" : "var(--color-surface-hover)",
                opacity: i === 0 ? 0.7 : 1,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function FlowSchematic() {
  return (
    <div className="w-full h-full flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-surface rounded-[var(--radius-sm)] border border-border-strong p-4 flex flex-col gap-2">
        <div className="h-1.5 w-3/4 bg-surface-3 rounded-full" />
        <div className="h-1.5 w-full bg-surface-3 rounded-full" />
        <div className="h-1.5 w-2/3 bg-surface-3 rounded-full" />
        {/* Slash command input block */}
        <div
          className="rounded-[var(--radius-sm)] px-3 py-2 border flex items-center gap-2"
          style={{ background: "var(--color-gold-muted)", borderColor: "var(--color-gold)" }}
        >
          <span
            className="font-[family-name:var(--font-mono)] text-sm font-bold anim-flow-caret"
            style={{ color: "var(--color-gold)" }}
          >
            /
          </span>
          <span className="text-xs text-text-muted flex-1">Describe what you need...</span>
        </div>
        <div className="h-1.5 w-full bg-surface-3 rounded-full anim-flow-line" />
        <div className="h-1.5 w-4/5 bg-surface-3 rounded-full anim-flow-line" style={{ animationDelay: "0.18s" }} />
      </div>
    </div>
  );
}

function RefineSchematic() {
  return (
    <div className="w-full h-full flex items-center justify-center p-4 relative">
      <div className="w-full max-w-sm bg-surface rounded-[var(--radius-sm)] border border-border-strong p-4 flex flex-col gap-2">
        <div className="h-1.5 w-3/4 bg-surface-3 rounded-full" />
        {/* Selected text */}
        <div
          className="rounded px-2 py-1 flex flex-col gap-1"
          style={{ background: "var(--color-gold-muted)", border: "1px solid var(--color-gold-strong)" }}
        >
          <div className="h-1.5 w-full rounded-full anim-refine-line" style={{ background: "var(--color-gold)", opacity: 0.5 }} />
          <div className="h-1.5 w-3/4 rounded-full anim-refine-line" style={{ background: "var(--color-gold)", opacity: 0.5, animationDelay: "0.12s" }} />
        </div>
        <div className="h-1.5 w-full bg-surface-3 rounded-full" />
        <div className="h-1.5 w-2/3 bg-surface-3 rounded-full" />

        {/* Floating toolbar ghost */}
        <div
          className="absolute top-8 left-1/2 -translate-x-1/2 flex items-center gap-1 px-2 py-1 rounded-[var(--radius-sm)] border shadow-xl anim-refine-toolbar"
          style={{ background: "var(--color-surface-3)", borderColor: "var(--color-border-strong)" }}
        >
          {["Snip", "Concise", "Elaborate", "Edit"].map((label) => (
            <button
              key={label}
              className={`px-2 py-0.5 rounded text-[9px] font-[family-name:var(--font-mono)] transition-colors ${label === "Concise" ? "anim-refine-active" : ""}`}
              style={{
                background: label === "Concise" ? "var(--color-gold-muted)" : "transparent",
                color: label === "Concise" ? "var(--color-gold)" : "var(--color-text-muted)",
                border: label === "Concise" ? "1px solid var(--color-gold-strong)" : "1px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── About You step ───────────────────────────────────────────────────────────

const WRITING_TYPES = [
  "Blog Posts",
  "Articles",
  "Journal",
  "Screenplays",
  "Novels / Books",
  "Short Stories",
  "Academic",
  "Marketing Copy",
  "Legal",
  "Technical",
  "Other",
] as const;

interface AboutYouStepProps {
  onContinue: () => void;
  onSkip: () => void;
}

function AboutYouStep({ onContinue, onSkip }: AboutYouStepProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [writingTypes, setWritingTypes] = useState<string[]>([]);

  const updateUserProfile = useSettingsStore((s) => s.updateUserProfile);
  const deviceId = useDeviceId();

  const toggleWritingType = useCallback((type: string) => {
    setWritingTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  const handleContinue = useCallback(() => {
    // 1. Save to local settings store
    updateUserProfile({
      displayName: name.trim(),
      email: email.trim(),
      writingTypes,
    });

    // 2. Fire-and-forget identify to Convex — never block UI
    void identify({
      deviceId,
      name: name.trim() || undefined,
      email: email.trim() || undefined,
      writingTypes,
      profileSource: "onboarding",
    }).catch(() => {
      // Silently ignore — onboarding must never fail due to analytics
    });

    // 3. Advance
    onContinue();
  }, [name, email, writingTypes, deviceId, updateUserProfile, onContinue]);

  // Name is the only thing we require — everything else is optional.
  const isValid = name.trim().length > 0;

  return (
    <div
      className="w-[560px] max-h-[90vh] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden"
      style={{ animation: "fadeIn 0.2s ease-out" }}
    >
      <div className="px-8 pt-7 pb-5 flex flex-col gap-3">
        <span className="text-[10px] uppercase tracking-widest text-text-faint font-[family-name:var(--font-mono)]">
          About You
        </span>
        <h2
          className="text-2xl text-text-primary leading-snug"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Tell us a bit about yourself.
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          This helps us personalize Fragment for you. Saved to your device.
        </p>
      </div>

      <div className="px-8 pb-7 flex flex-col gap-5 overflow-y-auto">
        {/* Name + Email row */}
        <div className="flex gap-3">
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[11px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-faint">
              Name
            </label>
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-surface-2 border border-border-strong rounded-[var(--radius-default)] text-[13px] text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150 px-3 py-2 w-full"
              autoFocus
            />
          </div>
          <div className="flex-1 flex flex-col gap-1.5">
            <label className="text-[11px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-faint">
              Email <span className="text-text-faint/60 normal-case tracking-normal">(optional)</span>
            </label>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-surface-2 border border-border-strong rounded-[var(--radius-default)] text-[13px] text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150 px-3 py-2 w-full"
            />
          </div>
        </div>

        {/* Writing types */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-faint">
            What do you write?
          </label>
          <p className="text-xs text-text-muted leading-relaxed -mt-0.5">
            Fragment is tuned for blog posts, articles, and short stories right now, with more on the way. It works beautifully for everything else too.
          </p>
          <div className="flex flex-wrap gap-2">
            {WRITING_TYPES.map((type) => {
              const selected = writingTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleWritingType(type)}
                  className={[
                    "rounded-full px-4 py-1.5 text-[12px] border transition-colors duration-150",
                    selected
                      ? "bg-gold/10 border-gold/30 text-gold"
                      : "bg-surface-2 border-border-strong text-text-muted hover:bg-surface-3 hover:border-border-active",
                  ].join(" ")}
                >
                  {type}
                </button>
              );
            })}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={onSkip}
            className="text-xs text-text-faint hover:text-text-muted transition-colors duration-150"
          >
            Skip
          </button>
          <button
            onClick={handleContinue}
            disabled={!isValid}
            className="flex items-center gap-1.5 px-5 py-2 rounded-[var(--radius-default)] text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "var(--color-gold-muted)",
              border: "1px solid var(--color-gold-strong)",
              color: "var(--color-gold)",
            }}
            onMouseEnter={(e) => {
              if (isValid) {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(232,185,49,0.2)";
              }
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--color-gold-muted)";
            }}
          >
            Continue
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Voice setup step ─────────────────────────────────────────────────────────

interface VoiceSetupStepProps {
  onContinue: () => void;
  onSkip: () => void;
}

interface PendingSample {
  id: string;
  title: string;
  text: string;
  source: VoiceSample["source"];
}

function VoiceSetupStep({ onContinue, onSkip }: VoiceSetupStepProps) {
  const [name, setName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [samples, setSamples] = useState<PendingSample[]>([]);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addBrandVoice = useVoiceStore((s) => s.addBrandVoice);
  const setDefaultVoice = useVoiceStore((s) => s.setDefaultVoice);

  const addPaste = useCallback(() => {
    if (!pasteText.trim()) return;
    const firstLine = pasteText.trim().split("\n")[0].slice(0, 60);
    setSamples((prev) => [
      ...prev,
      { id: generateId(), title: firstLine || "Pasted sample", text: pasteText.trim(), source: "paste" },
    ]);
    setPasteText("");
  }, [pasteText]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        try {
          const { title, text } = await extractSampleText(file);
          setSamples((prev) => [...prev, { id: generateId(), title, text, source: "file" }]);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Couldn't read that file.";
          useToastStore.getState().showToast(message);
        }
      }
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const removeSample = useCallback((id: string) => {
    setSamples((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const handleContinue = useCallback(() => {
    const id = addBrandVoice({ name: name.trim() || "My voice" });
    if (!id) {
      // At the voice cap (only reachable if voices were pre-seeded) — don't
      // silently drop the user's typed name + uploaded samples.
      useToastStore.getState().showToast("Voice limit reached — manage voices in Settings.");
      onContinue();
      return;
    }
    setDefaultVoice(id);
    if (samples.length > 0) {
      const now = Date.now();
      const rows: VoiceSample[] = samples.map((s, i) => ({
        id: s.id,
        voiceId: id,
        title: s.title,
        source: s.source,
        text: s.text,
        charCount: s.text.length,
        createdAt: now + i,
      }));
      // Persist samples, then kick off analysis in the background (survives unmount).
      void saveSamples(rows).then(() => {
        void analyzeVoice(id);
      });
    }
    onContinue();
  }, [name, samples, addBrandVoice, setDefaultVoice, onContinue]);

  const hasContent = samples.length > 0 || name.trim().length > 0;

  return (
    <div
      className="w-[560px] max-h-[90vh] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden"
      style={{ animation: "fadeIn 0.2s ease-out" }}
    >
      <div className="px-8 pt-7 pb-5 flex flex-col gap-3">
        <span className="text-[10px] uppercase tracking-widest text-text-faint font-[family-name:var(--font-mono)]">
          Your Voice
        </span>
        <h2 className="text-2xl text-text-primary leading-snug" style={{ fontFamily: "var(--font-display)" }}>
          Teach Fragment how you write.
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Fragment learns how you write from a few samples — every generation will sound like you.
          You can refine this anytime in Settings.
        </p>
      </div>

      <div className="px-8 pb-7 flex flex-col gap-5 overflow-y-auto">
        {/* Voice name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-faint">
            Voice name
          </label>
          <input
            type="text"
            placeholder="My voice"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-surface-2 border border-border-strong rounded-[var(--radius-default)] text-[13px] text-text-primary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150 px-3 py-2 w-full"
            autoFocus
          />
        </div>

        {/* Samples */}
        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-faint">
            Writing samples
          </label>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder="Paste a piece of your writing here…"
            rows={4}
            className="bg-surface-2 border border-border-strong rounded-[var(--radius-default)] text-[13px] text-text-secondary placeholder:text-text-faint outline-none focus:border-border-active transition-colors duration-150 px-3 py-2 w-full resize-y leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={addPaste}
              disabled={!pasteText.trim()}
              className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-surface-2 border border-border-strong text-[11px] text-text-secondary hover:text-text-primary hover:border-border-active transition-colors duration-150 disabled:opacity-40"
            >
              Add sample
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-surface-2 border border-border-strong text-[11px] text-text-secondary hover:text-text-primary hover:border-border-active transition-colors duration-150 disabled:opacity-40"
            >
              <Upload size={12} />
              {busy ? "Reading…" : "Upload file"}
            </button>
            <span className="text-[10px] text-text-faint">.md, .txt, .docx, .pdf</span>
            <input
              ref={fileInputRef}
              type="file"
              accept={SAMPLE_ACCEPT}
              multiple
              onChange={(e) => handleFiles(e.target.files)}
              className="hidden"
            />
          </div>

          {samples.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {samples.map((s) => (
                <span
                  key={s.id}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-2 border border-border-strong text-[11px] text-text-secondary"
                >
                  <FileText size={11} className="text-text-faint" />
                  <span className="max-w-[160px] truncate">{s.title}</span>
                  <button
                    onClick={() => removeSample(s.id)}
                    className="text-text-faint hover:text-red-400 transition-colors"
                    aria-label="Remove sample"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          <button
            onClick={onSkip}
            className="text-xs text-text-faint hover:text-text-muted transition-colors duration-150"
          >
            Skip for now
          </button>
          <button
            onClick={handleContinue}
            disabled={!hasContent}
            className="flex items-center gap-1.5 px-5 py-2 rounded-[var(--radius-default)] text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: "var(--color-gold-muted)",
              border: "1px solid var(--color-gold-strong)",
              color: "var(--color-gold)",
            }}
          >
            Continue
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Micro-steps list ─────────────────────────────────────────────────────────

function MicroSteps({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-col gap-2 mt-1">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <div
            className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
            style={{ background: "var(--color-gold)" }}
          />
          <span className="text-xs text-text-muted leading-relaxed">{step}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Feature card (steps 2–4) ─────────────────────────────────────────────────

interface FeatureStepProps {
  label: string;
  heading: string;
  body: string;
  steps: string[];
  videoSrc: string;
  fallbackSchematic: React.ReactNode;
  onNext: () => void;
  onSkip: () => void;
  isLast?: boolean;
}

function FeatureStep({
  label,
  heading,
  body,
  steps,
  videoSrc,
  fallbackSchematic,
  onNext,
  onSkip,
  isLast = false,
}: FeatureStepProps) {
  return (
    <div
      className="w-[640px] max-h-[90vh] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden"
      style={{ animation: "fadeIn 0.2s ease-out" }}
    >
      <div className="px-8 pt-7 pb-5 flex flex-col gap-3">
        <span className="text-[10px] uppercase tracking-widest text-text-faint font-[family-name:var(--font-mono)]">
          {label}
        </span>
        <h2
          className="text-2xl text-text-primary leading-snug"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {heading}
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">{body}</p>
        <MicroSteps steps={steps} />
      </div>

      <div className="px-8 pb-7 flex flex-col gap-5">
        <DemoArea src={videoSrc} fallback={fallbackSchematic} />

        <div className="flex items-center justify-between">
          <button
            onClick={onSkip}
            className="text-xs text-text-faint hover:text-text-muted transition-colors duration-150"
          >
            Skip
          </button>
          <button
            onClick={onNext}
            className="flex items-center gap-1.5 px-5 py-2 rounded-[var(--radius-default)] text-sm font-medium transition-all duration-150"
            style={{
              background: "var(--color-gold-muted)",
              border: "1px solid var(--color-gold-strong)",
              color: "var(--color-gold)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(232,185,49,0.2)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--color-gold-muted)";
            }}
          >
            {isLast ? "Continue" : "Next"}
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 1 — Note creation ───────────────────────────────────────────────────

interface NoteCreationStepProps {
  onNoteCreated: (id: string) => void;
  onSkip: () => void;
}

function NoteCreationStep({ onNoteCreated, onSkip }: NoteCreationStepProps) {
  const [view, setView] = useState<Step1View>("grid");
  const [pasteText, setPasteText] = useState("");
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const createNote = useDataStore((s) => s.createNote);
  const updateNoteContent = useDataStore((s) => s.updateNoteContent);
  const updateNoteTitle = useDataStore((s) => s.updateNoteTitle);
  const settings = useSettingsStore((s) => s.settings);
  const badProviders = useAppStore((s) => s.badProviders);
  const openAiGate = useAppStore((s) => s.openAiGate);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBlank = useCallback(() => {
    const id = createNote();
    onNoteCreated(id);
  }, [createNote, onNoteCreated]);

  const handlePasteConfirm = useCallback(() => {
    if (!pasteText.trim()) return;
    const id = createNote();
    // Extract a title from the first non-empty line
    const firstLine = pasteText.trim().split("\n")[0].replace(/^#+\s*/, "").trim();
    if (firstLine) updateNoteTitle(id, firstLine.slice(0, 80));
    updateNoteContent(id, pasteText.trim());
    onNoteCreated(id);
  }, [pasteText, createNote, updateNoteContent, updateNoteTitle, onNoteCreated]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt) => {
        const text = (evt.target?.result as string) ?? "";
        const id = createNote();
        const firstLine = text.trim().split("\n")[0].replace(/^#+\s*/, "").trim();
        if (firstLine) updateNoteTitle(id, firstLine.slice(0, 80));
        updateNoteContent(id, text.trim());
        onNoteCreated(id);
      };
      reader.readAsText(file);
    },
    [createNote, updateNoteContent, updateNoteTitle, onNoteCreated],
  );

  const handleGenerate = useCallback(async () => {
    if (!generatePrompt.trim()) return;
    setIsGenerating(true);
    setGenerateError(null);
    try {
      const provider = settings.featureProviders.slashCommand.provider;
      const model = settings.featureProviders.slashCommand.model;
      const apiKey = getProviderKey(provider, settings.providerCredentials);

      let content = "";

      if (provider === "ollama") {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: generatePrompt,
            context: "",
            goal: "",
            model,
            provider: "ollama",
          }),
        });
        if (!res.ok) throw new Error("Generation failed");
        content = await res.text();
      } else {
        if (!apiKey) {
          setGenerateError("No API key — set one in Settings first.");
          setIsGenerating(false);
          return;
        }
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: generatePrompt,
            context: "",
            goal: "",
            model,
            provider,
            apiKey,
          }),
        });
        if (!res.ok) throw new Error("Generation failed");
        content = await res.text();
      }

      const id = createNote();
      updateNoteTitle(id, generatePrompt.slice(0, 80));
      updateNoteContent(id, content.trim());
      onNoteCreated(id);
    } catch {
      setGenerateError("Generation failed. Check your AI settings and try again.");
    } finally {
      setIsGenerating(false);
    }
  }, [generatePrompt, settings, createNote, updateNoteContent, updateNoteTitle, onNoteCreated]);

  const isAiConfigured = hasWorkingProvider(settings, badProviders, "slashCommand");

  if (view === "paste") {
    return (
      <div
        className="w-[520px] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: "fadeIn 0.15s ease-out" }}
      >
        <div className="px-7 pt-6 pb-5 flex flex-col gap-3">
          <button
            onClick={() => setView("grid")}
            className="flex items-center gap-1.5 text-xs text-text-faint hover:text-text-muted transition-colors w-fit"
          >
            <ArrowLeft size={12} />
            Back
          </button>
          <h2
            className="text-xl text-text-primary"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Paste your content
          </h2>
          <p className="text-xs text-text-muted">Paste in text you&apos;ve already written.</p>
        </div>

        <div className="px-7 pb-7 flex flex-col gap-3">
          <textarea
            className="w-full rounded-[var(--radius-default)] bg-surface-2 border border-border-strong text-sm text-text-primary placeholder:text-text-faint resize-none focus:outline-none focus:border-gold/40 transition-colors p-3"
            style={{ minHeight: 160, fontFamily: "var(--font-body)" }}
            placeholder="Paste your text here..."
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            autoFocus
          />
          <div className="flex justify-end">
            <button
              onClick={handlePasteConfirm}
              disabled={!pasteText.trim()}
              className="px-5 py-2 rounded-[var(--radius-default)] text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--color-gold-muted)",
                border: "1px solid var(--color-gold-strong)",
                color: "var(--color-gold)",
              }}
            >
              Create note
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === "generate") {
    return (
      <div
        className="w-[520px] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden"
        style={{ animation: "fadeIn 0.15s ease-out" }}
      >
        <div className="px-7 pt-6 pb-5 flex flex-col gap-3">
          <button
            onClick={() => setView("grid")}
            className="flex items-center gap-1.5 text-xs text-text-faint hover:text-text-muted transition-colors w-fit"
          >
            <ArrowLeft size={12} />
            Back
          </button>
          <h2
            className="text-xl text-text-primary"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Generate with AI
          </h2>
          <p className="text-xs text-text-muted">Describe what you want to write.</p>
        </div>

        <div className="px-7 pb-7 flex flex-col gap-3">
          <textarea
            className="w-full rounded-[var(--radius-default)] bg-surface-2 border border-border-strong text-sm text-text-primary placeholder:text-text-faint resize-none focus:outline-none focus:border-gold/40 transition-colors p-3"
            style={{ minHeight: 100, fontFamily: "var(--font-body)" }}
            placeholder="e.g. A short essay about why constraints make you more creative..."
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate();
            }}
          />
          {generateError && (
            <p className="text-xs text-red">{generateError}</p>
          )}
          <div className="flex justify-end">
            <button
              onClick={handleGenerate}
              disabled={!generatePrompt.trim() || isGenerating}
              className="px-5 py-2 rounded-[var(--radius-default)] text-sm font-medium transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
              style={{
                background: "var(--color-gold-muted)",
                border: "1px solid var(--color-gold-strong)",
                color: "var(--color-gold)",
              }}
            >
              {isGenerating && (
                <span
                  className="w-3 h-3 rounded-full border-2 inline-block"
                  style={{
                    borderColor: "var(--color-gold) transparent var(--color-gold) transparent",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
              )}
              {isGenerating ? "Generating..." : "Generate"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const OPTIONS = [
    {
      icon: <FileText size={20} className="text-text-muted" />,
      title: "Blank note",
      desc: "Start with an empty page",
      onClick: handleBlank,
      disabled: false,
    },
    {
      icon: <ClipboardPaste size={20} className="text-text-muted" />,
      title: "Paste content",
      desc: "Paste in text you've already written",
      onClick: () => setView("paste"),
      disabled: false,
    },
    {
      icon: <Upload size={20} className="text-text-muted" />,
      title: "Import file",
      desc: "Open a .md or .txt file",
      onClick: () => fileInputRef.current?.click(),
      disabled: false,
    },
    {
      icon: <Sparkles size={20} className="text-text-muted" />,
      title: "Generate with AI",
      desc: "Describe what you want to write",
      onClick: isAiConfigured ? () => setView("generate") : () => openAiGate("no-provider"),
      disabled: false,
    },
  ];

  return (
    <div
      className="w-[520px] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden"
      style={{ animation: "fadeIn 0.2s ease-out" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt,.markdown"
        className="hidden"
        onChange={handleFileChange}
      />

      <div className="px-7 pt-7 pb-5 flex flex-col gap-2">
        <span className="text-[10px] uppercase tracking-widest text-text-faint font-[family-name:var(--font-mono)]">
          Your First Note
        </span>
        <h2
          className="text-2xl text-text-primary leading-snug"
          style={{ fontFamily: "var(--font-display)" }}
        >
          How do you want to start?
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          You can always create new notes from the sidebar. For now, pick one.
        </p>
      </div>

      <div className="px-7 pb-7 flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.title}
              onClick={opt.disabled ? undefined : opt.onClick}
              disabled={opt.disabled}
              className="flex flex-col items-start gap-2 p-4 rounded-[var(--radius-default)] border text-left transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: "var(--color-surface-2)",
                borderColor: "var(--color-border-strong)",
              }}
              onMouseEnter={(e) => {
                if (!opt.disabled) {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-gold-strong)";
                  (e.currentTarget as HTMLButtonElement).style.background = "var(--color-gold-muted)";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--color-border-strong)";
                (e.currentTarget as HTMLButtonElement).style.background = "var(--color-surface-2)";
              }}
            >
              {opt.icon}
              <div>
                <div className="text-sm font-medium text-text-primary">{opt.title}</div>
                <div className="text-xs text-text-muted mt-0.5">{opt.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="flex justify-center">
          <button
            onClick={onSkip}
            className="text-xs text-text-faint hover:text-text-muted transition-colors"
          >
            Skip this step
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Connect AI step ──────────────────────────────────────────────────────────

interface ConnectStepProps {
  onDone: () => void;
}

function ConnectStep({ onDone }: ConnectStepProps) {
  return (
    <div
      className="w-[560px] max-h-[90vh] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden"
      style={{ animation: "fadeIn 0.2s ease-out" }}
    >
      <div className="px-8 pt-7 pb-5 flex flex-col gap-3">
        <span className="text-[10px] uppercase tracking-widest text-text-faint font-[family-name:var(--font-mono)]">
          Connect AI
        </span>
        <h2
          className="text-2xl text-text-primary leading-snug"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Connect your AI backend.
        </h2>
        <p className="text-sm text-text-muted leading-relaxed">
          Snip, Flow, and Refine run on an AI provider you connect. Sign in with OpenAI or
          paste an API key — you only pay your provider for what you use. You can change this
          anytime in Settings.
        </p>
      </div>

      <div className="px-8 pb-7 flex flex-col gap-5 overflow-y-auto">
        <ConnectPanel
          activateFor={["snippetLabeling", "slashCommand", "inlineEdit"]}
          onConnected={onDone}
        />

        <div className="flex items-center justify-center">
          <button
            onClick={onDone}
            className="text-xs text-text-faint hover:text-text-muted transition-colors duration-150"
          >
            I&apos;ll do this later
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Step indices as a small enum rather than magic numbers.
 * CONNECT is conditional (skipped when hosted or a provider is already
 * connected — see `showConnectStep`), but still occupies index 1.
 * VOICE_SETUP lets the user seed their first Brand Voice from writing samples.
 * FEATURE_START..FEATURE_END covers the 3 feature-intro steps
 * (indexed as FEATURE_STEPS[step - FEATURE_START]).
 */
const ONBOARDING_STEPS = {
  WELCOME: 0,
  CONNECT: 1,
  ABOUT_YOU: 2,
  VOICE_SETUP: 3,
  NOTE_CREATION: 4,
  FEATURE_START: 5,
  FEATURE_END: 7,
  READY: 8,
} as const;

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0);
  const createdNoteIdRef = useRef<string | null>(null);

  const createNote = useDataStore((s) => s.createNote);
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const settings = useSettingsStore((s) => s.settings);

  // Skip the Connect step when AI already works (hosted managed AI, or a
  // provider is already connected) — don't nag returning/hosted users.
  const showConnectStep = !isHosted() && !hasAnyProviderPresent(settings);

  const overlayRef = useRef<HTMLDivElement>(null);

  const handleNoteCreated = useCallback(
    (id: string) => {
      createdNoteIdRef.current = id;
      setActiveNote(id);
      setStep(ONBOARDING_STEPS.FEATURE_START);
    },
    [setActiveNote],
  );

  const handleSkipStep2 = useCallback(() => {
    setStep(ONBOARDING_STEPS.FEATURE_START);
  }, []);

  const handleStartWriting = useCallback(() => {
    let noteId = createdNoteIdRef.current;
    if (!noteId) {
      noteId = createNote();
    }
    setActiveNote(noteId);
    onComplete();
  }, [createNote, setActiveNote, onComplete]);

  const advance = useCallback(() => {
    setStep((s) => s + 1);
  }, []);

  // Background click on overlay backdrop does NOT close onboarding (intentional — users
  // must either complete or explicitly press Esc / Skip).
  function handleBackdropClick(_e: React.MouseEvent) {
    // no-op: clicking the backdrop does not dismiss onboarding
  }

  const FEATURE_STEPS = [
    {
      label: "01 / SNIP",
      heading: "Pull your ideas apart.",
      body: "Think of it as a whiteboard for your ideas. Select any text in the editor that you want to save for later or move around. Drag it in and out of the editor. ",
      steps: [
        "Select text in the editor",
        "Click Snip or drag to the Snip Bar",
        "Drag cards back to rearrange",
      ],
      // Animated schematic is the motion graphic. To use real footage instead,
      // drop a clip at public/demos/snip-demo.mp4 and set videoSrc to "/demos/snip-demo.mp4".
      videoSrc: "",
      fallback: <SnipSchematic />,
    },
    {
      label: "02 / FLOW",
      heading: "Let AI meet you in the middle.",
      body: "Type / on an empty line to summon a writing prompt. Describe what you need. It reads everything above and below, so the result fits naturally. Preview, then insert or discard.",
      steps: [
        "Type / on an empty line",
        "Describe what you need",
        "Preview, then insert or discard",
      ],
      // Drop a clip at public/demos/flow-demo.mp4 and set videoSrc to use real footage.
      videoSrc: "",
      fallback: <FlowSchematic />,
    },
    {
      label: "03 / REFINE",
      heading: "Every sentence, reconsidered.",
      body: "Select any text and a floating toolbar appears. Make it Concise, Elaborate on it, or give a custom Edit instruction. Every rewrite is context-aware — it reads the full document, not just the selection.",
      steps: [
        "Select text in the editor",
        "Choose Concise, Elaborate, or Edit",
        "AI rewrites in context",
      ],
      // You already have a Refine clip at public/demos/in-line-edit.mp4 — set
      // videoSrc to "/demos/in-line-edit.mp4" to use it instead of the animation.
      videoSrc: "",
      fallback: <RefineSchematic />,
    },
  ];

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(12, 12, 11, 0.88)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation: "fadeIn 0.2s ease-out",
      }}
    >
      {/* Step 0 — Welcome */}
      {step === 0 && (
        <div
          className="flex flex-col items-center text-center gap-6 max-w-sm"
          style={{ animation: "fadeIn 0.3s ease-out" }}
        >
          <div className="flex flex-col gap-2">
            <h1
              className="text-5xl text-text-primary tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Fragment
            </h1>
            <p
              className="text-lg text-text-secondary"
              style={{ fontFamily: "var(--font-display)", fontStyle: "italic" }}
            >
              Writing is art, not labor.
            </p>
          </div>
          <p className="text-xs text-text-muted leading-relaxed max-w-xs">
            A writing tool that treats essays like puzzles. Three features, one philosophy: AI that writes with you, not for you.
          </p>
          <p
            className="text-[11px] text-text-faint leading-relaxed max-w-xs"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Fragment&apos;s AI runs on a provider you connect: sign in with ChatGPT, bring your own API key, or run models locally.
          </p>
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={() => setStep(showConnectStep ? ONBOARDING_STEPS.CONNECT : ONBOARDING_STEPS.ABOUT_YOU)}
              className="px-8 py-2.5 rounded-[var(--radius-default)] text-sm font-medium transition-all duration-150"
              style={{
                background: "var(--color-gold-muted)",
                border: "1px solid var(--color-gold-strong)",
                color: "var(--color-gold)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(232,185,49,0.2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--color-gold-muted)";
              }}
            >
              Begin
            </button>
            <button
              onClick={onComplete}
              className="text-xs text-text-faint hover:text-text-muted transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Step 1 — Connect AI (skipped when hosted or already connected) */}
      {step === ONBOARDING_STEPS.CONNECT && showConnectStep && (
        <ConnectStep onDone={() => setStep(ONBOARDING_STEPS.ABOUT_YOU)} />
      )}

      {/* Step 2 — About You */}
      {step === ONBOARDING_STEPS.ABOUT_YOU && (
        <AboutYouStep
          onContinue={() => setStep(ONBOARDING_STEPS.VOICE_SETUP)}
          onSkip={() => setStep(ONBOARDING_STEPS.VOICE_SETUP)}
        />
      )}

      {/* Step 3 — Voice setup */}
      {step === ONBOARDING_STEPS.VOICE_SETUP && (
        <VoiceSetupStep
          onContinue={() => setStep(ONBOARDING_STEPS.NOTE_CREATION)}
          onSkip={() => setStep(ONBOARDING_STEPS.NOTE_CREATION)}
        />
      )}

      {/* Step 4 — Create your first note */}
      {step === ONBOARDING_STEPS.NOTE_CREATION && (
        <NoteCreationStep
          onNoteCreated={handleNoteCreated}
          onSkip={handleSkipStep2}
        />
      )}

      {/* Steps 5–7 — Feature introductions */}
      {step >= ONBOARDING_STEPS.FEATURE_START && step <= ONBOARDING_STEPS.FEATURE_END && (
        <FeatureStep
          label={FEATURE_STEPS[step - ONBOARDING_STEPS.FEATURE_START].label}
          heading={FEATURE_STEPS[step - ONBOARDING_STEPS.FEATURE_START].heading}
          body={FEATURE_STEPS[step - ONBOARDING_STEPS.FEATURE_START].body}
          steps={FEATURE_STEPS[step - ONBOARDING_STEPS.FEATURE_START].steps}
          videoSrc={FEATURE_STEPS[step - ONBOARDING_STEPS.FEATURE_START].videoSrc}
          fallbackSchematic={FEATURE_STEPS[step - ONBOARDING_STEPS.FEATURE_START].fallback}
          onNext={advance}
          onSkip={onComplete}
          isLast={step === ONBOARDING_STEPS.FEATURE_END}
        />
      )}

      {/* Step 8 — Ready */}
      {step === ONBOARDING_STEPS.READY && (
        <div
          className="flex flex-col items-center text-center gap-6 max-w-sm"
          style={{ animation: "fadeIn 0.3s ease-out" }}
        >
          <div className="flex flex-col gap-2">
            <h1
              className="text-4xl text-text-primary tracking-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {"You're all set."}
            </h1>
            <p className="text-sm text-text-muted leading-relaxed">
              Snip, Flow, and Refine are always one gesture away.
            </p>
          </div>
          <p
            className="text-[10px] text-text-faint"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Press Cmd+/ anytime for shortcuts.
          </p>
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={handleStartWriting}
              className="px-8 py-2.5 rounded-[var(--radius-default)] text-sm font-medium transition-all duration-150"
              style={{
                background: "var(--color-gold-muted)",
                border: "1px solid var(--color-gold-strong)",
                color: "var(--color-gold)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(232,185,49,0.2)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--color-gold-muted)";
              }}
            >
              Start writing
            </button>
            <span className="text-xs text-text-faint">or press Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}
