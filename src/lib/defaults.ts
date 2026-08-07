import type { AppSettings } from "./types";
import type { AIProvider } from "./providers";

export const DEFAULT_LABELING_PROMPT = `You are a writing assistant. The user is working on an essay{goal}.

They have extracted this snippet:
---
{snippetContent}
---

Write a concise label (5-10 words max) that describes what this snippet is about. Return ONLY the label text, nothing else.`;

export const DEFAULT_GENERATION_PROMPT = `You are a writing assistant helping the user write an essay.

Essay goal: "{goal}"
Target audience: "{audience}"
Tone: "{tone}"
Additional context to remember: "{remember}"

Here is what the user has written so far ABOVE the insertion point:
---
{contextAbove}
---

Here is what comes AFTER the insertion point:
---
{contextBelow}
---

The user wants you to generate content to insert between the above and below sections.

User instruction: "{userInstruction}"

Write the content that should go between the two sections. Match the tone, style, and voice of the surrounding text.

Format your output with proper markdown syntax. Use # for headings, separate paragraphs with blank lines, and use **bold**, *italic*, lists, and blockquotes where they enhance readability.

Return ONLY the generated content — no explanations, no wrapping code fences.`;

export const DEFAULT_INLINE_EDIT_PROMPT = `You are a writing assistant helping edit a specific passage within a larger document.

Document goal: "{goal}"
Target audience: "{audience}"
Tone: "{tone}"
Additional context to remember: "{remember}"

Here is the text BEFORE the selected passage:
---
{contextBefore}
---

Here is the SELECTED TEXT to edit:
---
{selectedText}
---

Here is the text AFTER the selected passage:
---
{contextAfter}
---

Editing instruction: "{instruction}"

Rewrite the selected text according to the instruction. Your result must:
1. Flow naturally between the before and after context
2. Match the tone, style, and voice of the surrounding text
3. Only replace the selected text — do not repeat the before/after context

Return ONLY the edited text — no explanations, no markdown code fences, no quotes, just the replacement text.`;

/** Document shape for note generation. Deliberately document-shaped only:
 * short-form platform content (LinkedIn posts, tweets) belongs to pieces,
 * not notes, so it is not offered here. */
export type GenerateFormat = "freeform" | "essay" | "blog" | "newsletter" | "script";
export type GenerateLength = "auto" | "short" | "medium" | "long";

const FORMAT_INSTRUCTIONS: Record<GenerateFormat, string> = {
  freeform: "Use whatever structure fits the content best",
  essay: "Shape it as an essay: one clear through-line from opening to conclusion, built from paragraphs rather than bullet points, with headings only if the piece is long enough to need them",
  blog: "Shape it as a blog post: a hook up top, scannable sections with headings, short paragraphs",
  newsletter: "Shape it as a newsletter issue: address the reader directly, open strong, and separate the segments clearly",
  script: "Shape it as a spoken script: conversational sentences meant to be read aloud, clear beats, minimal formatting",
};

const LENGTH_INSTRUCTIONS: Record<GenerateLength, string> = {
  auto: "Choose a length that fits the subject and format",
  short: "Keep it short: roughly 150-300 words",
  medium: "Aim for roughly 500-800 words",
  long: "Write a full-length piece: roughly 1,200-2,000 words",
};

/** Compose the note-creation prompt template for the chosen format and length.
 * Format/length are baked into the template client-side (they come from fixed
 * enums, never user text); {goal}, {audience}, {tone}, {remember} and
 * {userInstruction} stay as placeholders for /api/generate to substitute. */
export function buildNoteCreationPrompt(
  format: GenerateFormat = "freeform",
  length: GenerateLength = "auto",
): string {
  return `You are a writing assistant. The user wants to create a new document from scratch.

Document goal: "{goal}"
Target audience: "{audience}"
Tone: "{tone}"
Additional context to remember: "{remember}"

The user described what they want to write:
"{userInstruction}"

Write a first draft based on their description. The draft should:
1. Start with a clear, compelling title as an H1 heading
2. ${FORMAT_INSTRUCTIONS[format]}
3. ${LENGTH_INSTRUCTIONS[length]}
4. Serve as a solid starting point that the user can refine
5. Be written in a natural, engaging tone

If the user's own description asks for a specific format or length, follow their description over the guidance above.

Return ONLY the draft content in markdown: no explanations, no code fences, just the document.`;
}

export const DEFAULT_NOTE_CREATION_PROMPT = buildNoteCreationPrompt();

// Sent through the same /api/generate substitution as Flow, so it may only use
// the placeholders that route knows: {goal}, {audience}, {tone}, {remember},
// {contextAbove}, {contextBelow}, {userInstruction}. The draft itself rides in
// {contextAbove}; the note's four context fields carry the metadata.
export const DEFAULT_TITLE_PROMPT = `You are a writing assistant. The user wants a title for the document they are writing.

Document goal: "{goal}"
Target audience: "{audience}"
Tone: "{tone}"
Additional context to remember: "{remember}"

Here is the document:
---
{contextAbove}
---

Write one title for it. The title must:
1. Say what this specific document is about, not what its category is
2. Fit the goal, audience and tone above
3. Stay under 70 characters
4. Read as a title: no closing punctuation, no quotes, no markdown

Return ONLY the title text, nothing else.`;

// The character/count limits stated in this prompt mirror the CAP_* constants
// in src/lib/voice-context.ts, which enforce them defensively after parsing.
// Keep the two in sync — if you bump a cap there, update the prose here too.
export const DEFAULT_VOICE_ANALYSIS_PROMPT = `You are a writing-voice analyst. Study the writing samples below and distill the author's voice into a compact, reusable profile.

Voice name: "{voiceName}"
Author's own description of their voice: "{description}"

WRITING SAMPLES:
{samples}

Return ONLY a single JSON object (no prose, no code fences) with exactly these fields:
{
  "summary": "2-4 sentences describing the voice — diction, rhythm, register, personality. Max 450 characters.",
  "traits": ["short concrete trait", "..."],            // up to 7, each max 90 chars
  "exampleExcerpts": ["verbatim quote from a sample", "..."],  // 3-5 short quotes copied EXACTLY from the samples, each max 320 chars
  "doGuidance": ["do this to sound like them", "..."],  // up to 5
  "dontGuidance": ["avoid this", "..."]                 // up to 5
}

Rules:
- exampleExcerpts MUST be copied verbatim from the samples — do not paraphrase or invent.
- Keep every field within its limit. Omit nothing; use [] only if truly nothing applies.
- Output the raw JSON object and nothing else.`;

export const DEFAULT_SETTINGS: AppSettings = {
  id: "default",
  providerCredentials: {
    openRouterApiKey: "",
    openAiApiKey: "",
    anthropicApiKey: "",
    perplexityApiKey: "",
    codexAccessToken: "",
    codexRefreshToken: "",
  },
  codexEnabledModels: [],
  featureProviders: {
    snippetLabeling: {
      provider: "openrouter",
      model: "google/gemini-2.0-flash-001",
      modelsByProvider: {
        openrouter: "google/gemini-2.0-flash-001",
        openai: "gpt-4o-mini",
        anthropic: "claude-3-5-haiku-latest",
        perplexity: "sonar",
        codex: "gpt-5.4-mini",
        ollama: "llama3",
      } satisfies Partial<Record<AIProvider, string>>,
    },
    slashCommand: {
      provider: "openrouter",
      model: "google/gemini-2.0-flash-001",
      modelsByProvider: {
        openrouter: "anthropic/claude-sonnet-4.6",
        openai: "gpt-4o",
        anthropic: "claude-sonnet-4-5",
        perplexity: "sonar-pro",
        codex: "gpt-5.4",
        ollama: "llama3",
      } satisfies Partial<Record<AIProvider, string>>,
    },
    inlineEdit: {
      provider: "openrouter",
      model: "google/gemini-2.0-flash-001",
      modelsByProvider: {
        openrouter: "anthropic/claude-sonnet-4.6",
        openai: "gpt-4o",
        anthropic: "claude-sonnet-4-5",
        perplexity: "sonar-pro",
        codex: "gpt-5.4",
        ollama: "llama3",
      } satisfies Partial<Record<AIProvider, string>>,
    },
  },
  userProfile: {
    displayName: "",
    bio: "",
    website: "",
    twitterHandle: "",
    linkedinUrl: "",
    location: "",
    email: "",
    writingTypes: [],
    role: "",
    substackPublicationUrl: "",
    kitApiKey: "",
    composioApiKey: "",
    linkedInConnectedAccountId: "",
  },
  writingStyle: {
    voiceDescription: "",
  },
  brandVoice: {
    defaultVoiceId: null,
    analysisPromptTemplate: DEFAULT_VOICE_ANALYSIS_PROMPT,
    migratedFromWritingStyle: false,
  },
  imageGeneration: {
    themeDescription: "",
    stylePreset: "editorial",
    customPresets: [],
  },
  snippetLabeling: {
    enabled: true,
    maxEssayContext: 0,
    promptTemplate: DEFAULT_LABELING_PROMPT,
  },
  slashCommand: {
    enabled: true,
    maxContextAbove: 3000,
    maxContextBelow: 3000,
    promptTemplate: DEFAULT_GENERATION_PROMPT,
  },
  inlineEdit: {
    enabled: true,
    maxContextChars: 3000,
    promptTemplate: DEFAULT_INLINE_EDIT_PROMPT,
  },
};
