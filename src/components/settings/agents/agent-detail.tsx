"use client";

import { ArrowLeft, Lock, RotateCcw } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { Toggle } from "@/components/ui/toggle";
import { ProviderToggle } from "../provider-toggle";
import { ModelSelector } from "../model-selector";
import { useFeatureProvider } from "@/hooks/use-feature-provider";
import { AgentDemo } from "./agent-demo";
import { useAgentWriters } from "./agent-writes";
import {
  agentPrompt,
  agentPromptIsCustom,
  type AgentDefinition,
} from "@/lib/agents/registry";

/**
 * One agent, opened: what it does, what it reads, which model answers it, and
 * the prompt it is running. Every field comes from the registry, so a new
 * agent arrives here complete without a component being written for it.
 */
export function AgentDetail({
  agent,
  onBack,
}: {
  agent: AgentDefinition;
  onBack: () => void;
}) {
  const { settings, updateFeatureProvider } = useSettingsStore();
  const writers = useAgentWriters(agent);

  const prompt = agentPrompt(agent, settings);
  const isCustom = agentPromptIsCustom(agent, settings);
  const enabled = agent.readEnabled?.(settings);
  const providerKey = agent.providerKey;
  // Called unconditionally (hook rules); the result is only read when the
  // agent has a provider key of its own.
  const effective = useFeatureProvider(providerKey ?? "slashCommand");
  const featureConfig = providerKey ? effective : undefined;
  const setContextLimit = writers.setContextLimit;
  // A built-in agent has no picker of its own: it rides on the model chosen for
  // Flow. Saying so beats showing a control that silently steers three agents.
  const borrowsModel = providerKey !== undefined && agent.promptIsBuiltIn;

  return (
    <div className="flex gap-8">
      <div className="flex-1 min-w-0 max-w-[480px] space-y-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[11px] text-text-faint hover:text-text-secondary transition-colors duration-150"
        >
          <ArrowLeft size={12} />
          All agents
        </button>

        {/* Name, what it does, and the off switch when it has one */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-base font-[family-name:var(--font-display)] text-text-primary">
              {agent.name}
            </h3>
            {enabled !== undefined && writers.setEnabled && (
              <Toggle checked={enabled} onChange={writers.setEnabled} />
            )}
          </div>
          <p className="text-[11px] text-text-faint leading-relaxed">{agent.does}</p>
          <p className="text-[11px] text-text-faint leading-relaxed mt-1">
            Runs: {agent.runsAt}
          </p>
        </div>

        {agent.demoVideo && (
          <div className="xl:hidden w-[260px]">
            <AgentDemo src={agent.demoVideo} />
          </div>
        )}

        <div className="rounded-[var(--radius-default)] border-l-2 border-gold/30 bg-gold/5 px-4 py-3">
          <p className="text-[11px] text-text-muted leading-relaxed">
            <span className="text-text-secondary font-medium">How it works</span>
            {". "}
            {agent.howItWorks}
          </p>
        </div>

        {/* Which model answers */}
        {featureConfig && providerKey && (
          <div className="space-y-3">
            <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider">
              Provider
            </label>
            {borrowsModel ? (
              <p className="text-[11px] text-text-faint leading-relaxed">
                Uses the same provider and model as Flow. Change it there and this
                agent follows.
              </p>
            ) : (
              <>
                <ProviderToggle
                  value={featureConfig.provider}
                  onChange={(provider) => {
                    if (provider === featureConfig.provider) return;
                    updateFeatureProvider(providerKey, { provider });
                  }}
                />
                <ModelSelector
                  value={featureConfig.model}
                  provider={featureConfig.provider}
                  onChange={(model) =>
                    updateFeatureProvider(providerKey, { provider: featureConfig.provider, model })
                  }
                />
              </>
            )}
          </div>
        )}

        {/* How much of your writing it reads */}
        {agent.contextLimits && setContextLimit && (
          <div
            className={
              agent.contextLimits.length > 1 ? "grid grid-cols-2 gap-3" : undefined
            }
          >
            {agent.contextLimits.map((limit) => (
              <div key={limit.key}>
                <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
                  {limit.label}
                </label>
                <input
                  type="number"
                  min={0}
                  max={10000}
                  step={500}
                  value={limit.read(settings)}
                  onChange={(e) =>
                    setContextLimit(limit.key, parseInt(e.target.value) || 0)
                  }
                  className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-primary outline-none focus:border-border-active transition-colors duration-150"
                />
                <p className="text-[10px] text-text-faint mt-1">{limit.help}</p>
              </div>
            ))}
          </div>
        )}

        {/* The prompt */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="flex items-center gap-2 text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider">
              Prompt
              {isCustom && <span className="text-gold normal-case">edited</span>}
            </label>
            {writers.resetPrompt && (
              <button
                onClick={writers.resetPrompt}
                className="flex items-center gap-1 text-[10px] text-text-faint hover:text-text-muted transition-colors duration-150"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            )}
          </div>
          <textarea
            value={prompt}
            readOnly={!writers.setPrompt}
            onChange={(e) => writers.setPrompt?.(e.target.value)}
            rows={12}
            className={`w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-[11px] text-text-secondary font-[family-name:var(--font-mono)] leading-relaxed outline-none transition-colors duration-150 resize-y ${
              writers.setPrompt
                ? "focus:border-border-active"
                : "opacity-70 cursor-default"
            }`}
          />
          {agent.promptIsBuiltIn && (
            <p className="flex items-center gap-1.5 text-[10px] text-text-faint mt-1.5 leading-relaxed">
              <Lock size={9} className="shrink-0" />
              Built in. This prompt is assembled when the agent runs, from the
              choices you make at that moment, so there is no fixed version to
              edit. What you see is the shape it starts from.
            </p>
          )}
          {agent.variables.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider">
                What Fragment fills in
              </p>
              {agent.variables.map((v) => (
                <p key={v.token} className="text-[10px] text-text-faint leading-relaxed">
                  <span className="font-[family-name:var(--font-mono)] text-text-muted">
                    {v.token}
                  </span>
                  {" "}
                  {v.describes}
                </p>
              ))}
            </div>
          )}
        </div>
      </div>

      {agent.demoVideo && (
        <div className="hidden xl:flex w-[260px] shrink-0 flex-col justify-center sticky top-0 self-start h-[calc(100vh-200px)]">
          <AgentDemo src={agent.demoVideo} />
        </div>
      )}
    </div>
  );
}
