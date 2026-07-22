"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { Toggle } from "@/components/ui/toggle";
import { ProviderToggle } from "./provider-toggle";
import { ModelSelector } from "./model-selector";

function DemoVideo({ onError, hasError }: { onError: () => void; hasError: boolean }) {
  return (
    <div className="w-full rounded-[var(--radius-default)] border border-border-strong bg-surface-2 overflow-hidden">
      {!hasError ? (
        <video
          src="/demos/refine-demo.mp4"
          autoPlay
          loop
          muted
          playsInline
          onError={onError}
          className="w-full h-auto"
        />
      ) : (
        <div className="aspect-[4/3] flex items-center justify-center">
          <p className="text-[10px] text-text-faint text-center px-4 leading-relaxed">
            Drop a screen recording at<br />
            <span className="font-[family-name:var(--font-mono)] text-text-muted">public/demos/refine-demo.mp4</span>
          </p>
        </div>
      )}
    </div>
  );
}

export function InlineEditSettings() {
  const { settings, updateInlineEdit, resetInlineEditPrompt, updateFeatureProvider } =
    useSettingsStore();
  const inlineEdit = settings.inlineEdit;
  const featureConfig = settings.featureProviders.inlineEdit;
  const [videoError, setVideoError] = useState(false);

  return (
    <div className="flex gap-8">
      {/* Settings column */}
      <div className="flex-1 min-w-0 max-w-[480px] space-y-6">
        {/* Header with enable toggle */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-[family-name:var(--font-display)] text-text-primary">
              Refine{" "}
              <span className="text-text-faint text-sm">(inline editing)</span>
            </h3>
            <Toggle
              checked={inlineEdit.enabled}
              onChange={(v) => updateInlineEdit({ enabled: v })}
            />
          </div>
          <p className="text-[11px] text-text-faint leading-relaxed">
            Highlight any text to reveal a floating toolbar with Snip, Concise, Elaborate, or custom Edit — all changes happen in place.
          </p>
        </div>

        {/* Demo video — inline on smaller screens */}
        <div className="xl:hidden w-[260px]">
          <DemoVideo onError={() => setVideoError(true)} hasError={videoError} />
        </div>

        {/* How it works aside */}
        <div className="rounded-[var(--radius-default)] border-l-2 border-gold/30 bg-gold/5 px-4 py-3">
          <p className="text-[11px] text-text-muted leading-relaxed">
            <span className="text-text-secondary font-medium">How it works</span>
            {" — "}
            Every edit is context-aware. When you refine a selection, Fragment reads the full surrounding text — what comes before, what comes after, your essay goal, audience, and tone.
            The result fits naturally into the document as if you wrote it yourself, not like a disconnected AI replacement.
          </p>
        </div>

        {/* Provider + Model */}
        <div className="space-y-3">
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider">
            Provider
          </label>
          <ProviderToggle
            value={featureConfig.provider}
            onChange={(provider) => {
              if (provider === featureConfig.provider) return;
              updateFeatureProvider("inlineEdit", { provider });
            }}
          />
          <ModelSelector
            value={featureConfig.model}
            provider={featureConfig.provider}
            onChange={(model) => updateFeatureProvider("inlineEdit", { model })}
          />
        </div>

        {/* Context limit */}
        <div>
          <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
            Context around selection (chars)
          </label>
          <input
            type="number"
            min={0}
            max={10000}
            step={500}
            value={inlineEdit.maxContextChars}
            onChange={(e) =>
              updateInlineEdit({ maxContextChars: parseInt(e.target.value) || 0 })
            }
            className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary outline-none focus:border-border-active transition-colors duration-150"
          />
          <p className="text-[10px] text-text-faint mt-1">
            How much surrounding text to send for context when editing a selection.
          </p>
        </div>

        {/* Prompt template */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider">
              Prompt template
            </label>
            <button
              onClick={resetInlineEditPrompt}
              className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          </div>
          <textarea
            value={inlineEdit.promptTemplate}
            onChange={(e) =>
              updateInlineEdit({ promptTemplate: e.target.value })
            }
            rows={10}
            className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-[11px] text-text-secondary font-[family-name:var(--font-mono)] leading-relaxed outline-none focus:border-border-active transition-colors duration-150 resize-y"
          />
          <p className="text-[10px] text-text-faint mt-1">
            Variables: {"{selectedText}"}, {"{contextBefore}"}, {"{contextAfter}"}, {"{instruction}"}, {"{goal}"}, {"{audience}"}, {"{tone}"}, {"{remember}"}
          </p>
        </div>
      </div>

      {/* Demo video column — sticky centered on wide screens */}
      <div className="hidden xl:flex w-[260px] shrink-0 flex-col justify-center sticky top-0 self-start h-[calc(100vh-200px)]">
        <DemoVideo onError={() => setVideoError(true)} hasError={videoError} />
      </div>
    </div>
  );
}
