/**
 * Fragment's own agents, in one place, as plain data.
 *
 * Every AI process in the app is an agent: something with a name, a job you
 * can describe in a sentence, and a prompt you are allowed to read and
 * change. Before this file each one was a hand-built settings panel, which
 * meant the answer to "what does Fragment's AI actually do, and what is it
 * told to do" lived in four components and nowhere a person could look.
 *
 * Deliberately free of framework imports and browser APIs, like the help
 * catalog, so it can be read from a client component, a server route, and any
 * static file we generate. Reads are pure functions over AppSettings. Writes
 * are not here, because they need the settings store, and a data file that
 * reaches for a store stops being data.
 *
 * Naming: these are Fragment's agents, running inside the app on your text.
 * The Agent access settings are a different thing wearing a similar word:
 * outside agents (Claude, an MCP client) connecting in through a token to
 * write into your ideas. Both are agents to the person using them, so the
 * word stays, and each surface says which direction it points.
 */

import type { AppSettings } from "@/lib/types";
import {
  DEFAULT_GENERATION_PROMPT,
  DEFAULT_INLINE_EDIT_PROMPT,
  DEFAULT_LABELING_PROMPT,
  DEFAULT_NOTE_CREATION_PROMPT,
  DEFAULT_TITLE_PROMPT,
  DEFAULT_VOICE_ANALYSIS_PROMPT,
  DEFAULT_EXTRACT_PROMPT,
} from "@/lib/defaults";

export type AgentId =
  | "snip-labeler"
  | "flow-writer"
  | "refine-editor"
  | "voice-analyst"
  | "title-writer"
  | "draft-writer"
  | "idea-extractor";

/**
 * Which feature-provider config picks an agent's model. Only the three
 * processes that shipped with their own picker have one; the rest borrow a
 * neighbour's, which the detail view says out loud rather than implying every
 * agent is separately steerable.
 */
export type AgentProviderKey =
  | "snippetLabeling"
  | "slashCommand"
  | "inlineEdit"
  | "ideaExtractor";

export interface AgentVariable {
  /** The placeholder as it appears in the prompt, braces included. */
  token: string;
  /** What Fragment substitutes for it, in the words the UI uses. */
  describes: string;
}

/**
 * A number that decides how much of your writing an agent is allowed to read.
 * Modelled here rather than hand-built per panel because the answer to "how
 * much of my draft is being sent" belongs next to the prompt that receives it.
 */
export interface AgentContextLimit {
  /** Stable id, used by the write bridge to pick the settings field. */
  key: "maxContextAbove" | "maxContextBelow" | "maxContextChars";
  label: string;
  help: string;
  read: (settings: AppSettings) => number;
}

export interface AgentDefinition {
  /** Stable id. Renaming one is a breaking change to every caller. */
  id: AgentId;
  /** What the UI calls it. */
  name: string;
  /** One sentence: the job. Assume the reader has never opened Settings. */
  does: string;
  /** Where you meet it, in the user's words, not in component names. */
  runsAt: string;
  /**
   * The longer explanation, shown when the agent is open. Says what it reads
   * as well as what it writes, because "what does it see" is the question
   * people actually have about an AI process touching their draft.
   */
  howItWorks: string;
  /** Every placeholder the prompt accepts, each with what fills it. */
  variables: readonly AgentVariable[];
  /** What Reset goes back to, and what a built-in agent is running. */
  defaultPrompt: string;
  /** Absent when the agent has no prompt of its own to edit yet. */
  readPrompt?: (settings: AppSettings) => string;
  /** Absent when the agent cannot be turned off. */
  readEnabled?: (settings: AppSettings) => boolean;
  providerKey?: AgentProviderKey;
  /** How much of your writing this agent reads. Empty when it is not tunable. */
  contextLimits?: readonly AgentContextLimit[];
  /**
   * A short recording of the agent at work, shown beside its settings. The
   * file may not exist yet, in which case the space is left empty rather than
   * showing a broken frame.
   */
  demoVideo?: string;
  /**
   * True when the prompt is compiled from the format and length you pick at
   * the moment you run it, so there is no single template to hand over.
   */
  promptIsBuiltIn: boolean;
}

export const AGENTS: readonly AgentDefinition[] = [
  {
    id: "snip-labeler",
    name: "Snip labeler",
    does: "Names a snip so you can recognise it later without re-reading it.",
    runsAt: "Every time you snip text out of a draft.",
    howItWorks:
      "When you snip text, the labeler reads the snippet along with the surrounding draft and the goal you set for the idea, then writes a short label. That is what turns a pile of raw snippets into cards you can scan and rearrange at a glance.",
    variables: [
      { token: "{goal}", describes: "the goal set on the idea, when there is one" },
      { token: "{snippetContent}", describes: "the text you snipped" },
    ],
    defaultPrompt: DEFAULT_LABELING_PROMPT,
    readPrompt: (s) => s.snippetLabeling.promptTemplate,
    readEnabled: (s) => s.snippetLabeling.enabled,
    providerKey: "snippetLabeling",
    demoVideo: "/demos/snip-demo.mp4",
    promptIsBuiltIn: false,
  },
  {
    id: "flow-writer",
    name: "Flow",
    does: "Writes the passage that goes where your cursor is.",
    runsAt: "Press / on an empty line in a draft.",
    howItWorks:
      "Flow reads what you have written above and below the cursor, plus the idea's goal, audience, tone and anything you told it to remember, and writes the passage that belongs between them. It is given the surrounding text so the new paragraphs sound like the ones around them rather than like a fresh document.",
    variables: [
      { token: "{goal}", describes: "the goal set on the idea" },
      { token: "{audience}", describes: "who the idea is written for" },
      { token: "{tone}", describes: "the tone set on the idea" },
      { token: "{remember}", describes: "anything you added to the brief" },
      { token: "{contextAbove}", describes: "the draft above the cursor" },
      { token: "{contextBelow}", describes: "the draft below the cursor" },
      { token: "{userInstruction}", describes: "what you typed after the slash" },
    ],
    defaultPrompt: DEFAULT_GENERATION_PROMPT,
    readPrompt: (s) => s.slashCommand.promptTemplate,
    readEnabled: (s) => s.slashCommand.enabled,
    providerKey: "slashCommand",
    contextLimits: [
      {
        key: "maxContextAbove",
        label: "Context above (chars)",
        help: "How much text before the cursor to include as context.",
        read: (s) => s.slashCommand.maxContextAbove,
      },
      {
        key: "maxContextBelow",
        label: "Context below (chars)",
        help: "How much text after the cursor to include as context.",
        read: (s) => s.slashCommand.maxContextBelow,
      },
    ],
    demoVideo: "/demos/flow-demo.mp4",
    promptIsBuiltIn: false,
  },
  {
    id: "refine-editor",
    name: "Refine",
    does: "Rewrites a passage you have selected, and leaves the rest alone.",
    runsAt: "Select text in a draft and ask for an edit.",
    howItWorks:
      "Refine is given the selected passage on its own, with the text on either side as context it may read but must not rewrite. That boundary is the point: the edit comes back scoped to what you highlighted, so you can accept it without re-reading the whole draft.",
    variables: [
      { token: "{selectedText}", describes: "the passage you selected" },
      { token: "{contextBefore}", describes: "the draft before the selection" },
      { token: "{contextAfter}", describes: "the draft after the selection" },
      { token: "{instruction}", describes: "the edit you asked for" },
      { token: "{goal}", describes: "the goal set on the idea" },
      { token: "{audience}", describes: "who the idea is written for" },
      { token: "{tone}", describes: "the tone set on the idea" },
      { token: "{remember}", describes: "anything you added to the brief" },
    ],
    defaultPrompt: DEFAULT_INLINE_EDIT_PROMPT,
    readPrompt: (s) => s.inlineEdit.promptTemplate,
    readEnabled: (s) => s.inlineEdit.enabled,
    providerKey: "inlineEdit",
    contextLimits: [
      {
        key: "maxContextChars",
        label: "Context around selection (chars)",
        help: "How much surrounding text to send for context when editing a selection.",
        read: (s) => s.inlineEdit.maxContextChars,
      },
    ],
    demoVideo: "/demos/in-line-edit.mp4",
    promptIsBuiltIn: false,
  },
  {
    id: "voice-analyst",
    name: "Voice analyst",
    does: "Reads your writing samples and distils them into a reusable voice.",
    runsAt: "Brand Voice settings, when you analyse a set of samples.",
    howItWorks:
      "The analyst reads the samples you saved for a voice and returns a compact profile: how you build sentences, which words you reach for, what you never do. Every other agent then gets that profile instead of the raw samples, which is why one careful analysis improves everything downstream.",
    variables: [
      { token: "{voiceName}", describes: "the name you gave the voice" },
      { token: "{description}", describes: "your own description of it, when there is one" },
      { token: "{samples}", describes: "the writing samples saved on the voice" },
    ],
    defaultPrompt: DEFAULT_VOICE_ANALYSIS_PROMPT,
    readPrompt: (s) => s.brandVoice.analysisPromptTemplate,
    promptIsBuiltIn: false,
  },
  {
    id: "idea-extractor",
    name: "Idea extractor",
    does: "Reads a whole idea and pulls out each part that stands on its own.",
    runsAt: "Extract from the whole idea, in an idea's panel, or right-click one draft.",
    howItWorks:
      "The extractor is the only agent that reads a whole idea at once: the brief, every draft, every piece already in it, and the sources attached to it. Right-clicking a single draft points it at that draft alone, which is the version to use when several drafts are open and you need to know which one a piece came out of. It looks for the sections and concepts that are already complete thoughts, and writes each one out as its own piece. Each piece holds exactly one idea, carries whatever context that idea needs to be understood alone, and holds nothing else. Everything it writes lands in the idea's inbox for you to triage, because several pieces written at once from material you did not re-read is exactly the work that should not skip a review.",
    variables: [
      { token: "{source}", describes: "everything in the idea: brief, drafts, pieces and sources" },
      { token: "{goal}", describes: "the goal set on the idea" },
      { token: "{audience}", describes: "who the idea is written for" },
      { token: "{tone}", describes: "the tone set on the idea" },
      { token: "{remember}", describes: "anything you added to the brief" },
    ],
    defaultPrompt: DEFAULT_EXTRACT_PROMPT,
    readPrompt: (s) => s.ideaExtractor.promptTemplate,
    readEnabled: (s) => s.ideaExtractor.enabled,
    providerKey: "ideaExtractor",
    promptIsBuiltIn: false,
  },
  {
    id: "title-writer",
    name: "Title writer",
    does: "Proposes a title for the draft you are in.",
    runsAt: "Ask for a title on an untitled draft.",
    howItWorks:
      "The title writer reads the opening of the draft and the idea's brief, and proposes a title. It runs on the same model as Flow, so changing Flow's model changes this one too.",
    variables: [],
    defaultPrompt: DEFAULT_TITLE_PROMPT,
    providerKey: "slashCommand",
    promptIsBuiltIn: true,
  },
  {
    id: "draft-writer",
    name: "Draft writer",
    does: "Writes a first draft from nothing but your brief.",
    runsAt: "Generate a draft on an empty idea.",
    howItWorks:
      "The draft writer is the only agent with no existing text to work from, so it leans entirely on the brief and the format and length you pick when you run it. Its prompt is assembled from those choices at the moment you press the button, which is why there is no single template here to edit.",
    variables: [],
    defaultPrompt: DEFAULT_NOTE_CREATION_PROMPT,
    providerKey: "slashCommand",
    promptIsBuiltIn: true,
  },
];

export function agentById(id: string): AgentDefinition | undefined {
  return AGENTS.find((a) => a.id === id);
}

/**
 * The prompt an agent is actually running: the user's version when they have
 * edited it, the default when they have not, and for a built-in agent the
 * default it compiles from. Callers get one string and do not have to know
 * which case they are in.
 */
export function agentPrompt(agent: AgentDefinition, settings: AppSettings): string {
  const stored = agent.readPrompt?.(settings);
  return stored && stored.trim().length > 0 ? stored : agent.defaultPrompt;
}

/** True when the user has changed this agent's prompt away from the default. */
export function agentPromptIsCustom(agent: AgentDefinition, settings: AppSettings): boolean {
  if (agent.promptIsBuiltIn) return false;
  const stored = agent.readPrompt?.(settings);
  return stored !== undefined && stored !== agent.defaultPrompt;
}
