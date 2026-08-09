/**
 * Pure helpers behind the short-form piece's Refine menu and Flow generation
 * (ARI-157). No Zustand, no React, no clocks read internally — mirrors the
 * convention already set by src/stores/content-selectors.ts and
 * src/components/shortform/feed-logic.ts, so this stays deterministic and
 * unit-testable without mocking the DOM or the AI hooks.
 *
 * Voice resolution note: these helpers carry one voice id through to
 * useInlineEdit/useSlashCommand, which resolve it against the default voice
 * via resolveVoice(voices, defaultVoiceId, voiceId). The idea's voice is what
 * callers normally pass. A fragment also carries a voiceId of its own (three
 * states, see the content contract), so a caller that wants the fragment's
 * choice to win passes that instead; there is deliberately no second
 * resolution path in here to disagree with the hook's.
 */

import type { Brief } from "@/lib/brief-context";
import type { ContentFormat } from "@/lib/content-engine";
import type { PublishPlatform } from "@/lib/publish";
import { PLATFORM_CHAR_LIMITS, charCount } from "@/lib/publish";

/** Mirrors piece-card.tsx's FORMAT_TO_PLATFORM — the short-form formats that
 * map onto a publish platform with its own character-limit conventions.
 * essay/script/other have no platform (long-form-shaped short-form pieces). */
export const FORMAT_TO_PLATFORM: Partial<Record<ContentFormat, PublishPlatform>> = {
  tweet: "tweet",
  linkedin: "linkedin",
  substack: "substack",
};

const PLATFORM_NOUN: Record<PublishPlatform, string> = {
  tweet: "tweet segment",
  linkedin: "LinkedIn post",
  substack: "Substack post",
  html: "document",
};

/**
 * Builds the "platform + char limit" hint appended to the Refine/Flow AI
 * context for a piece, e.g. "This is a tweet segment, hard limit 280
 * characters. Currently 340/280 characters — over the limit, aim to bring
 * it under 280." Returns null for formats with no publish platform (essay,
 * script, other).
 */
export function platformContextHint(format: ContentFormat, body: string): string | null {
  const platform = FORMAT_TO_PLATFORM[format];
  if (!platform) return null;
  const limit = PLATFORM_CHAR_LIMITS[platform];
  const noun = PLATFORM_NOUN[platform];
  if (limit == null) return `This is a ${noun}. No hard character limit.`;
  const count = charCount(body);
  const base = `This is a ${noun}, hard limit ${limit} characters.`;
  if (count > limit) {
    return `${base} Currently ${count}/${limit} characters — over the limit, aim to bring it under ${limit}.`;
  }
  return base;
}

// ---------------------------------------------------------------------------
// Refine (inline edit) context assembly
// ---------------------------------------------------------------------------

export interface PieceIdeaContext {
  title?: string;
  summary?: string;
  voiceId?: string;
}

export interface RefineContextInput {
  format: ContentFormat;
  body: string;
  selectionStart: number;
  selectionEnd: number;
  idea?: PieceIdeaContext;
  /** Resolved fragment → idea → voice brief (see lib/brief-context.ts). */
  brief?: Brief;
}

export interface RefineContext {
  contextBefore: string;
  contextAfter: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  voiceId: string | undefined;
}

/**
 * Assembles the useInlineEdit() call arguments for a piece: before/after
 * context sliced from the piece body around the selection, the idea's title
 * as the "goal" (mirrors how a long-form Note's goal is used), and the
 * idea's summary plus the platform/char-limit hint folded into "remember"
 * (the field the prompt template already surfaces as "context to always
 * keep in mind" — a natural home for a hard limit the model must respect).
 */
export function buildRefineContext(input: RefineContextInput): RefineContext {
  const { format, body, selectionStart, selectionEnd, idea, brief } = input;
  const start = Math.max(0, Math.min(selectionStart, body.length));
  const end = Math.max(start, Math.min(selectionEnd, body.length));
  const hint = platformContextHint(format, body);
  const remember = [brief?.remember, idea?.summary, hint]
    .filter((v): v is string => !!v)
    .join("\n\n");
  return {
    contextBefore: body.slice(0, start),
    contextAfter: body.slice(end),
    // The idea's title is the fallback goal it always was; a real goal set on
    // the fragment or the idea now takes precedence over it.
    goal: brief?.goal || idea?.title || "",
    audience: brief?.audience ?? "",
    tone: brief?.tone ?? "",
    remember,
    voiceId: idea?.voiceId,
  };
}

// ---------------------------------------------------------------------------
// Flow (generation) context assembly
// ---------------------------------------------------------------------------

export interface FlowContextInput {
  format: ContentFormat;
  idea?: PieceIdeaContext;
  /**
   * Everything the idea holds, from buildIdeaBrief in lib/ai-context.
   *
   * This used to be the text of "the idea's long-form draft", singular, found
   * by taking the oldest long-form piece. That assumed every idea has exactly
   * one long piece that counts as its draft, which is not how anyone works: an
   * idea can hold three short pieces and no long one, or two long ones with
   * equal claim. The brief describes what is actually there.
   */
  ideaBrief: string;
  /**
   * What the writer typed into the Flow prompt. Required, and there is no
   * default, because Flow used to run with a canned instruction the moment a
   * key was pressed: no prompt, no confirmation, just a page of text nobody
   * asked for. Generating is now something you ask for in words.
   */
  instruction: string;
  /** Resolved fragment → idea → voice brief (see lib/brief-context.ts). */
  brief?: Brief;
}

export interface FlowContext {
  contextAbove: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  instruction: string;
  voiceId: string | undefined;
}

const FLOW_DRAFT_NOUN: Record<ContentFormat, string> = {
  tweet: "tweet",
  linkedin: "LinkedIn post",
  substack: "Substack post",
  essay: "piece",
  script: "script",
  other: "piece",
};

/**
 * Assembles the useSlashCommand().generateStream() call arguments for
 * drafting a piece with Flow.
 *
 * The idea's brief stands in for "context above" (there is no mid-document
 * split when drafting a piece from the top), and the idea's title plus the
 * platform hint feed goal/remember exactly as in buildRefineContext. The
 * writer's own words lead the instruction; the format noun trails it, so
 * "make it angrier about the pricing" still comes out shaped like a tweet
 * without the format overriding what was asked for.
 */
export function buildFlowContext(input: FlowContextInput): FlowContext {
  const { format, idea, ideaBrief, instruction, brief } = input;
  const hint = platformContextHint(format, "");
  const remember = [brief?.remember, idea?.summary, hint]
    .filter((v): v is string => !!v)
    .join("\n\n");
  return {
    contextAbove: ideaBrief,
    // The idea's title is the fallback goal it always was; a real goal set on
    // the fragment or the idea now takes precedence over it.
    goal: brief?.goal || idea?.title || "",
    audience: brief?.audience ?? "",
    tone: brief?.tone ?? "",
    remember,
    instruction: `${instruction.trim()}\n\nWrite it as a ${FLOW_DRAFT_NOUN[format]}, and use the context above so it belongs to this idea rather than restating it.`,
    voiceId: idea?.voiceId,
  };
}

// A "Snip out" from a piece used to route through resolveSnipTargetNoteId,
// which hunted for some note to file the snippet against because
// Snippet.noteId was mandatory. It refused the snip when it found none —
// which is the normal state of an idea whose pieces came from an agent. A
// snippet can be filed against an idea now (see lib/snip-scope.ts), so the
// hunt, and the refusal, are both gone.

// ---------------------------------------------------------------------------
// Refine menu anchor (selection-range math)
// ---------------------------------------------------------------------------

export interface TextareaGeometry {
  /** getBoundingClientRect().top of the textarea itself. */
  top: number;
  /** getBoundingClientRect().left of the textarea itself. */
  left: number;
  /** How far the textarea's own content is scrolled (textarea.scrollTop). */
  scrollTop: number;
  /** Computed line-height in px. */
  lineHeight: number;
}

export interface MenuAnchor {
  top: number;
  left: number;
}

/**
 * Approximates the on-screen anchor point for the Refine menu above a
 * textarea selection. There's no per-character layout available outside the
 * DOM (no measureText/Range API here), so this estimates the selection's
 * vertical line by counting newlines before the selection start and
 * multiplying by line height — "approximate line position is fine" per the
 * spec. Clamped so the menu never anchors above the textarea's own top edge
 * — anchoring to the card's top edge is the explicit fallback for a
 * selection on the first visible line or when line-height can't be read.
 */
export function estimateSelectionAnchor(
  value: string,
  selectionStart: number,
  geometry: TextareaGeometry,
): MenuAnchor {
  const before = value.slice(0, Math.max(0, Math.min(selectionStart, value.length)));
  const lineIndex = (before.match(/\n/g) ?? []).length;
  const rawTop = geometry.top - geometry.scrollTop + lineIndex * geometry.lineHeight;
  const top = Math.max(geometry.top, rawTop);
  return { top, left: geometry.left };
}
