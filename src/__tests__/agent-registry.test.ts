import { describe, expect, it } from "vitest";
import {
  AGENTS,
  agentById,
  agentPrompt,
  agentPromptIsCustom,
  type AgentDefinition,
} from "@/lib/agents/registry";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import type { AppSettings } from "@/lib/types";

function withPrompt(agent: AgentDefinition, prompt: string): AppSettings {
  // The registry reads through accessors, so a test has to write to the same
  // place the real settings do rather than to a field of its own invention.
  switch (agent.id) {
    case "snip-labeler":
      return {
        ...DEFAULT_SETTINGS,
        snippetLabeling: { ...DEFAULT_SETTINGS.snippetLabeling, promptTemplate: prompt },
      };
    case "flow-writer":
      return {
        ...DEFAULT_SETTINGS,
        slashCommand: { ...DEFAULT_SETTINGS.slashCommand, promptTemplate: prompt },
      };
    case "refine-editor":
      return {
        ...DEFAULT_SETTINGS,
        inlineEdit: { ...DEFAULT_SETTINGS.inlineEdit, promptTemplate: prompt },
      };
    case "voice-analyst":
      return {
        ...DEFAULT_SETTINGS,
        brandVoice: { ...DEFAULT_SETTINGS.brandVoice, analysisPromptTemplate: prompt },
      };
    case "idea-extractor":
      return {
        ...DEFAULT_SETTINGS,
        ideaExtractor: { ...DEFAULT_SETTINGS.ideaExtractor, promptTemplate: prompt },
      };
    default:
      return DEFAULT_SETTINGS;
  }
}

describe("agent registry", () => {
  it("gives every agent a unique id", () => {
    const ids = AGENTS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds an agent by id, and nothing by a wrong one", () => {
    expect(agentById("flow-writer")?.name).toBe("Flow");
    expect(agentById("no-such-agent")).toBeUndefined();
  });

  it("describes every agent in a way the settings page can render", () => {
    for (const agent of AGENTS) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.does.length).toBeGreaterThan(0);
      expect(agent.runsAt.length).toBeGreaterThan(0);
      expect(agent.howItWorks.length).toBeGreaterThan(0);
      expect(agent.defaultPrompt.length).toBeGreaterThan(0);
    }
  });

  // The point of listing variables is that a reader can trust them. A token
  // documented but absent from the prompt is worse than no list at all.
  it("only documents variables the default prompt actually uses", () => {
    for (const agent of AGENTS) {
      for (const variable of agent.variables) {
        expect(
          agent.defaultPrompt.includes(variable.token),
          `${agent.id} documents ${variable.token} but its prompt never uses it`,
        ).toBe(true);
      }
    }
  });

  it("explains what fills every variable it lists", () => {
    for (const agent of AGENTS) {
      for (const variable of agent.variables) {
        expect(variable.describes.length).toBeGreaterThan(0);
      }
    }
  });

  it("resolves an unedited prompt to the default", () => {
    for (const agent of AGENTS) {
      expect(agentPrompt(agent, DEFAULT_SETTINGS)).toBe(agent.defaultPrompt);
      expect(agentPromptIsCustom(agent, DEFAULT_SETTINGS)).toBe(false);
    }
  });

  it("resolves an edited prompt to the user's version", () => {
    const editable = AGENTS.filter((a) => a.readPrompt !== undefined);
    expect(editable.length).toBeGreaterThan(0);
    for (const agent of editable) {
      const settings = withPrompt(agent, "my own words");
      expect(agentPrompt(agent, settings)).toBe("my own words");
      expect(agentPromptIsCustom(agent, settings)).toBe(true);
    }
  });

  // Clearing the box should leave the agent working, not send an empty prompt.
  it("falls back to the default when the user empties the prompt", () => {
    for (const agent of AGENTS.filter((a) => a.readPrompt !== undefined)) {
      expect(agentPrompt(agent, withPrompt(agent, "   "))).toBe(agent.defaultPrompt);
    }
  });

  it("never calls a built-in agent's prompt edited", () => {
    for (const agent of AGENTS.filter((a) => a.promptIsBuiltIn)) {
      expect(agent.readPrompt).toBeUndefined();
      expect(agentPromptIsCustom(agent, DEFAULT_SETTINGS)).toBe(false);
    }
  });

  it("points every tunable context limit at a real number", () => {
    for (const agent of AGENTS) {
      for (const limit of agent.contextLimits ?? []) {
        expect(Number.isFinite(limit.read(DEFAULT_SETTINGS))).toBe(true);
        expect(limit.label.length).toBeGreaterThan(0);
        expect(limit.help.length).toBeGreaterThan(0);
      }
    }
  });
});
