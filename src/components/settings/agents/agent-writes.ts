"use client";

/**
 * The write half of the agent registry.
 *
 * Reads are pure functions on the registry, which is why that file can stay
 * plain data. Writes need the settings store, and every agent's prompt lives
 * under a different key with its own updater, so the mapping has to exist
 * somewhere. It exists here, once, as a single switch: adding an agent means
 * one case, and forgetting one is a type error rather than a control that
 * silently does nothing.
 */

import { useSettingsStore } from "@/stores/settings-store";
import type { AgentContextLimit, AgentDefinition } from "@/lib/agents/registry";

export interface AgentWriters {
  /** Absent when the agent's prompt is built in and has nothing to save. */
  setPrompt?: (value: string) => void;
  resetPrompt?: () => void;
  /** Absent when the agent cannot be turned off. */
  setEnabled?: (value: boolean) => void;
  setContextLimit?: (key: AgentContextLimit["key"], value: number) => void;
}

export function useAgentWriters(agent: AgentDefinition): AgentWriters {
  const {
    updateSnippetLabeling,
    updateSlashCommand,
    updateInlineEdit,
    updateIdeaExtractor,
    updateBrandVoiceSettings,
    resetSnippetLabelingPrompt,
    resetSlashCommandPrompt,
    resetInlineEditPrompt,
    resetIdeaExtractorPrompt,
    resetVoiceAnalysisPrompt,
  } = useSettingsStore();

  switch (agent.id) {
    case "snip-labeler":
      return {
        setPrompt: (promptTemplate) => updateSnippetLabeling({ promptTemplate }),
        resetPrompt: resetSnippetLabelingPrompt,
        setEnabled: (enabled) => updateSnippetLabeling({ enabled }),
      };
    case "flow-writer":
      return {
        setPrompt: (promptTemplate) => updateSlashCommand({ promptTemplate }),
        resetPrompt: resetSlashCommandPrompt,
        setEnabled: (enabled) => updateSlashCommand({ enabled }),
        setContextLimit: (key, value) => {
          if (key === "maxContextAbove") updateSlashCommand({ maxContextAbove: value });
          if (key === "maxContextBelow") updateSlashCommand({ maxContextBelow: value });
        },
      };
    case "refine-editor":
      return {
        setPrompt: (promptTemplate) => updateInlineEdit({ promptTemplate }),
        resetPrompt: resetInlineEditPrompt,
        setEnabled: (enabled) => updateInlineEdit({ enabled }),
        setContextLimit: (key, value) => {
          if (key === "maxContextChars") updateInlineEdit({ maxContextChars: value });
        },
      };
    case "voice-analyst":
      return {
        setPrompt: (analysisPromptTemplate) =>
          updateBrandVoiceSettings({ analysisPromptTemplate }),
        resetPrompt: resetVoiceAnalysisPrompt,
      };
    case "idea-extractor":
      return {
        setPrompt: (promptTemplate) => updateIdeaExtractor({ promptTemplate }),
        resetPrompt: resetIdeaExtractorPrompt,
        setEnabled: (enabled) => updateIdeaExtractor({ enabled }),
      };
    case "title-writer":
    case "draft-writer":
      // Built in. Their prompts are compiled at the moment they run, so there
      // is nothing to persist; the detail view shows them read-only.
      return {};
  }
}
