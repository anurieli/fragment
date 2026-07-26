/**
 * Pure helpers behind the short-form piece's Refine menu and Flow generation
 * (ARI-157). No Zustand, no React, no clocks read internally — mirrors the
 * convention already set by src/stores/content-selectors.ts and
 * src/components/shortform/feed-logic.ts, so this stays deterministic and
 * unit-testable without mocking the DOM or the AI hooks.
 *
 * Voice resolution note: a ContentPiece has no voiceId field of its own.
 * The chain is idea.voiceId -> default voice, i.e. exactly what
 * resolveVoice(voices, defaultVoiceId, idea?.voiceId) already does — so
 * callers just pass idea?.voiceId as the voiceId argument to
 * useInlineEdit/useSlashCommand and the existing hook resolves it. No new
 * resolution logic is needed here beyond picking that field off the idea.
 */

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
}

export interface RefineContext {
  contextBefore: string;
  contextAfter: string;
  goal: string;
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
  const { format, body, selectionStart, selectionEnd, idea } = input;
  const start = Math.max(0, Math.min(selectionStart, body.length));
  const end = Math.max(start, Math.min(selectionEnd, body.length));
  const hint = platformContextHint(format, body);
  const remember = [idea?.summary, hint].filter((v): v is string => !!v).join("\n\n");
  return {
    contextBefore: body.slice(0, start),
    contextAfter: body.slice(end),
    goal: idea?.title ?? "",
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
  /** The idea's linked long-form note content, if one exists — see
   * findLinkedNoteContent below. */
  linkedNoteContent?: string | null;
}

export interface FlowContext {
  contextAbove: string;
  goal: string;
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
 * drafting a piece from scratch (⌘⏎ / "Draft with Flow"): the idea's linked
 * long-form note stands in for "context above" (there's no mid-document
 * split for a short-form piece — Flow here always drafts from the top), the
 * idea's title/summary plus the platform hint feed goal/remember exactly as
 * in buildRefineContext, and a default instruction names the target format
 * since there's no typed prompt for the ⌘⏎ path.
 */
export function buildFlowContext(input: FlowContextInput): FlowContext {
  const { format, idea, linkedNoteContent } = input;
  const hint = platformContextHint(format, "");
  const remember = [idea?.summary, hint].filter((v): v is string => !!v).join("\n\n");
  return {
    contextAbove: linkedNoteContent ?? "",
    goal: idea?.title ?? "",
    remember,
    instruction: `Draft this as a ${FLOW_DRAFT_NOUN[format]} based on the idea above.`,
    voiceId: idea?.voiceId,
  };
}

// ---------------------------------------------------------------------------
// Linked long-form note lookup (for Flow context + Snip-out destination)
// ---------------------------------------------------------------------------

export interface PieceLike {
  id: string;
  ideaId: string;
  noteId?: string;
  deletedAt?: number;
  updatedAt: number;
}

/** The idea's own long-form sibling piece (noteId set), most-recently-updated
 * first — an idea can have at most one content home per format, but nothing
 * stops multiple long-form pieces (essay + script) sharing an idea, so this
 * picks the freshest. Returns null when the idea has no long-form piece. */
export function findLinkedNoteId(ideaId: string, pieces: readonly PieceLike[]): string | null {
  const longForm = pieces
    .filter((p) => p.ideaId === ideaId && p.deletedAt === undefined && p.noteId !== undefined)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
  return longForm?.noteId ?? null;
}

/** Resolves findLinkedNoteId to the note's actual content via the notes map. */
export function findLinkedNoteContent(
  ideaId: string,
  pieces: readonly PieceLike[],
  notes: Record<string, { content: string } | undefined>,
): string | null {
  const noteId = findLinkedNoteId(ideaId, pieces);
  if (!noteId) return null;
  return notes[noteId]?.content ?? null;
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
