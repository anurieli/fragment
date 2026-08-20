"use client";

import { useState } from "react";
import { ChevronRight, Lock, Pencil } from "lucide-react";
import { useSettingsStore } from "@/stores/settings-store";
import { AGENTS, agentPromptIsCustom, type AgentId } from "@/lib/agents/registry";
import { AgentDetail } from "./agent-detail";

/**
 * Every agent Fragment runs, in one list, with what each one does.
 *
 * The list is the answer to a question the app could not answer before: what
 * is the AI in here actually doing, and what is it being told. Clicking one
 * opens its prompt.
 */
export function AgentsSection() {
  const { settings } = useSettingsStore();
  const [openId, setOpenId] = useState<AgentId | null>(null);

  const open = openId ? AGENTS.find((a) => a.id === openId) : undefined;
  if (open) {
    return <AgentDetail agent={open} onBack={() => setOpenId(null)} />;
  }

  return (
    <div className="max-w-[560px]">
      <h3 className="flex items-center gap-2 text-base font-[family-name:var(--font-display)] text-text-primary mb-1">
        Agents
      </h3>
      <p className="text-[11px] text-text-faint mb-5 leading-relaxed">
        Every AI process in Fragment is an agent with a job and a prompt. Open one
        to read what it is told and change it.
      </p>

      <div className="space-y-1.5">
        {AGENTS.map((agent) => {
          const enabled = agent.readEnabled?.(settings);
          const edited = agentPromptIsCustom(agent, settings);
          return (
            <button
              key={agent.id}
              onClick={() => setOpenId(agent.id)}
              className="w-full flex items-start gap-3 text-left px-4 py-3 rounded-[var(--radius-default)] border border-border bg-surface-2 hover:border-border-strong hover:bg-surface-3 transition-all duration-150"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-text-primary font-medium">
                    {agent.name}
                  </span>
                  {enabled === false && (
                    <span className="text-[9px] text-text-faint font-[family-name:var(--font-mono)] uppercase tracking-wider border border-border-strong rounded px-1.5 py-0.5">
                      off
                    </span>
                  )}
                  {edited && (
                    <span
                      className="flex items-center gap-1 text-[9px] text-gold font-[family-name:var(--font-mono)] uppercase tracking-wider"
                      title="You have changed this prompt"
                    >
                      <Pencil size={8} />
                      edited
                    </span>
                  )}
                  {agent.promptIsBuiltIn && (
                    <span
                      className="text-text-faint"
                      title="Built in: this prompt is assembled when the agent runs"
                    >
                      <Lock size={9} />
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-text-faint leading-relaxed mt-0.5">
                  {agent.does}
                </p>
              </div>
              <ChevronRight size={14} className="text-text-faint shrink-0 mt-1" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
