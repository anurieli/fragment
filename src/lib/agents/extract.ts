/**
 * The idea extractor, minus the model call.
 *
 * Two pure halves, both here because both are where this feature goes wrong.
 * Assembling what the agent reads, and reading back what it returns.
 *
 * The job, stated the way it was asked for: look at everything in an idea and
 * pull out each section or concept that stands on its own. One extracted piece
 * holds exactly one idea, carries the context needed to understand that idea
 * without the rest, and holds nothing else. A piece that needs the draft it
 * came from in order to make sense is a quote, not a piece.
 */

import type { ContentPiece, Idea, Resource } from "@/lib/content-engine";
import { isLongformFormat } from "@/lib/content-engine";

/** No more than this many pieces from one run, whatever the model returns. */
export const MAX_EXTRACTED = 12;

/**
 * How much of an idea is sent. Generous, because the whole premise is that the
 * agent reads everything, but bounded: the route refuses anything over its own
 * prompt ceiling, and being refused after a long wait is worse than being told
 * up front that only the first part was read.
 */
export const MAX_SOURCE_CHARS = 24000;

export interface ExtractedPiece {
  title: string;
  body: string;
}

export interface ExtractSource {
  /** Everything the agent reads, as one document. */
  text: string;
  /** True when the idea was longer than the ceiling and got cut. */
  truncated: boolean;
  /** How many drafts and pieces went in, for the confirmation copy. */
  draftCount: number;
  resourceCount: number;
}

function section(heading: string, body: string): string {
  return `## ${heading}\n${body.trim()}\n`;
}

/**
 * Everything in one idea, as a single document for the agent to read.
 *
 * Ordered the way a person would read it: what the idea is for, then the
 * long-form drafts, then the short-form pieces, then the sources attached to
 * it. Each part is labelled, because "which of these is my own writing and
 * which is something I pasted in" changes what may be extracted from it.
 */
export function buildExtractSource(
  idea: Idea,
  pieces: readonly ContentPiece[],
  resources: readonly Resource[],
): ExtractSource {
  const live = pieces.filter((p) => !p.deletedAt && p.ideaId === idea.id);
  const drafts = live.filter((p) => isLongformFormat(p.format));
  const shortform = live.filter((p) => !isLongformFormat(p.format));
  const attached = resources.filter(
    (r) => r.ownerType === "idea" && r.ownerId === idea.id,
  );

  const parts: string[] = [];
  parts.push(section("The idea", idea.title || "Untitled"));

  const brief = [
    idea.goal && `Goal: ${idea.goal}`,
    idea.audience && `Audience: ${idea.audience}`,
    idea.tone && `Tone: ${idea.tone}`,
    idea.remember && `Remember: ${idea.remember}`,
    idea.summary && `About: ${idea.summary}`,
  ]
    .filter(Boolean)
    .join("\n");
  if (brief) parts.push(section("The brief", brief));

  for (const draft of drafts) {
    if (!draft.body.trim()) continue;
    parts.push(section(`Draft: ${draft.title?.trim() || "Untitled"}`, draft.body));
  }
  for (const piece of shortform) {
    if (!piece.body.trim()) continue;
    parts.push(section(`Existing piece (${piece.format})`, piece.body));
  }
  for (const resource of attached) {
    // A resource is a reference rather than a document: what Fragment holds is
    // the link and whatever the writer said about it, so that is what goes in.
    const said = [resource.url, resource.note?.trim()].filter(Boolean).join("\n");
    if (!said) continue;
    parts.push(section(`Source: ${resource.title || "Untitled"}`, said));
  }

  const full = parts.join("\n");
  const truncated = full.length > MAX_SOURCE_CHARS;

  return {
    text: truncated ? full.slice(0, MAX_SOURCE_CHARS) : full,
    truncated,
    draftCount: drafts.length + shortform.length,
    resourceCount: attached.length,
  };
}

/** True when there is enough written down to be worth asking about. */
export function hasEnoughToExtract(source: ExtractSource): boolean {
  return source.text.trim().length >= 200;
}

/**
 * Pull the JSON array out of a completion.
 *
 * Models wrap JSON in prose and in code fences however firmly they are asked
 * not to, and one unusable response after a paid call is the worst outcome
 * here, so this is deliberately forgiving: fences are stripped, and the first
 * bracketed array in the text is tried. Anything still unparseable returns
 * null rather than throwing, so the caller can say "that did not come back in
 * a shape I can use" instead of showing a stack trace.
 */
function findJsonArray(raw: string): unknown {
  const withoutFences = raw
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  const candidates = [withoutFences];
  const start = withoutFences.indexOf("[");
  const end = withoutFences.lastIndexOf("]");
  if (start !== -1 && end > start) candidates.push(withoutFences.slice(start, end + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next shape.
    }
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The pieces a completion actually contains.
 *
 * Every entry has to have words in it. An entry with a title and no body is
 * the model naming something it did not write, and creating an empty piece
 * from it would put the writer back where they started with more rows to
 * clean up. Titles are optional: a piece with no title labels itself with its
 * first line everywhere else in the app, and that is fine here too.
 */
export function parseExtracted(raw: string): ExtractedPiece[] | null {
  const parsed = findJsonArray(raw);
  if (!Array.isArray(parsed)) return null;

  const out: ExtractedPiece[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const body = asString(record.body);
    if (!body) continue;
    out.push({ title: asString(record.title), body });
    if (out.length >= MAX_EXTRACTED) break;
  }
  return out;
}
