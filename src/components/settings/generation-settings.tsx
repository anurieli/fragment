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
          src="/demos/flow-demo.mp4"
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
            <span className="font-[family-name:var(--font-mono)] text-text-muted">public/demos/flow-demo.mp4</span>
          </p>
        </div>
      )}
    </div>
  );
}

export function GenerationSettings() {
  const { settings, updateSlashCommand, resetSlashCommandPrompt, updateFeatureProvider } =
    useSettingsStore();
  const slash = settings.slashCommand;
  const featureConfig = settings.featureProviders.slashCommand;
  const [videoError, setVideoError] = useState(false);

  return (
    <div className="flex gap-8">
      {/* Settings column */}
      <div className="flex-1 min-w-0 max-w-[480px] space-y-6">
        {/* Header with enable toggle */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-[family-name:var(--font-display)] text-text-primary">
              Text generation{" "}
              <span className="text-text-faint text-sm">(Flow + Generate)</span>
            </h3>
            <Toggle
              checked={slash.enabled}
              onChange={(v) => updateSlashCommand({ enabled: v })}
            />
          </div>
          <p className="text-[11px] text-text-faint leading-relaxed">
            Powers both Flow (type <span className="font-[family-name:var(--font-mono)] text-text-muted">/</span> inline in the editor to generate text mid-document) and &quot;Generate with AI&quot; when creating a draft. The provider and model below apply to both.
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
            When you trigger generation, Fragment reads the text before and after the cursor to understand where you are in your document.
            The generated text is shaped to fit seamlessly between what comes before and after — matching tone, continuing the thought, and respecting the surrounding structure.
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
              updateFeatureProvider("slashCommand", { provider });
            }}
          />
          <ModelSelector
            value={featureConfig.model}
            provider={featureConfig.provider}
            onChange={(model) => updateFeatureProvider("slashCommand", { model })}
          />
        </div>

        {/* Context limits */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
              Context above (chars)
            </label>
            <input
              type="number"
              min={0}
              max={10000}
              step={500}
              value={slash.maxContextAbove}
              onChange={(e) =>
                updateSlashCommand({ maxContextAbove: parseInt(e.target.value) || 0 })
              }
              className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary outline-none focus:border-border-active transition-colors duration-150"
            />
            <p className="text-[10px] text-text-faint mt-1">
              How much text before the cursor to include as context.
            </p>
          </div>
          <div>
            <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
              Context below (chars)
            </label>
            <input
              type="number"
              min={0}
              max={10000}
              step={500}
              value={slash.maxContextBelow}
              onChange={(e) =>
                updateSlashCommand({ maxContextBelow: parseInt(e.target.value) || 0 })
              }
              className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary outline-none focus:border-border-active transition-colors duration-150"
            />
            <p className="text-[10px] text-text-faint mt-1">
              How much text after the cursor to include as context.
            </p>
          </div>
        </div>

        {/* Prompt template */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider">
              Prompt template
            </label>
            <button
              onClick={resetSlashCommandPrompt}
              className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150"
            >
              <RotateCcw size={10} />
              Reset
            </button>
          </div>
          <textarea
            value={slash.promptTemplate}
            onChange={(e) =>
              updateSlashCommand({ promptTemplate: e.target.value })
            }
            rows={10}
            className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-[11px] text-text-secondary font-[family-name:var(--font-mono)] leading-relaxed outline-none focus:border-border-active transition-colors duration-150 resize-y"
          />
          <p className="text-[10px] text-text-faint mt-1">
            Variables: {"{goal}"}, {"{contextAbove}"}, {"{contextBelow}"}, {"{userInstruction}"}
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
