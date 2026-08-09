/**
 * What the model is told about where it is writing.
 *
 * Flow used to generate with `contextAbove: ""`. Standing inside an idea that
 * already held six pieces and a stack of sources, it was handed the writer's
 * one-line prompt and nothing else, so it answered the only way it could: with
 * a competent, generic, unusable draft about roughly the right subject. The
 * complaint that it "writes a long piece of nonsense" is that gap, not the
 * model.
 *
 * Pure on purpose. No Zustand, no clocks, no fetch: callers pass in what they
 * already hold, so the brief is unit-testable against fixtures and can be
 * reused by any surface that generates (Flow today, Refine and the slash
 * command next).
 */

import type { ContentPiece, Idea } from "@/lib/content-engine";
import type { EffectiveResource } from "@/stores/resources-selectors";
import { markdownToPlainText } from "@/lib/publish";

/**
 * Caps. A brief is a briefing, not a context dump: past a point the real
 * instruction drowns, and every extra token is paid for on every keystroke of
 * a streamed generation. These are deliberately small, and what gets cut is
 * always announced rather than silently dropped.
 */
export const MAX_SIBLINGS = 8;
export const SIBLING_EXCERPT_CHARS = 240;
export const MAX_RESOURCES = 12;

export type BriefPiece = Pick<ContentPiece, "id" | "title" | "body" | "updatedAt">;

export interface IdeaBriefInput {
  idea: Pick<Idea, "title" | "summary"> | null;
  /** Live pieces already in the idea, minus the one being written into. */
  siblings: readonly BriefPiece[];
  /** The effective set, own plus inherited (see resources-selectors). */
  resources: readonly EffectiveResource[];
}

/** Collapse markdown to one line of prose, truncated on a word boundary. */
function excerpt(body: string, limit: number): string {
  const flat = markdownToPlainText(body).replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut) + "...";
}

/** The label a sibling is listed under: its title, else its opening words. */
function pieceLabel(piece: BriefPiece): string {
  const title = piece.title?.trim();
  if (title) return title;
  const opening = excerpt(piece.body, 60);
  return opening || "Untitled";
}

function resourceLine(entry: EffectiveResource): string {
  const { resource } = entry;
  const parts = [resource.title.trim()];
  if (resource.url) parts.push(`(${resource.url})`);
  if (resource.note?.trim()) parts.push(`: ${resource.note.trim()}`);
  return parts.join(" ");
}

/**
 * The briefing block, ready to ride in the prompt's {contextAbove} slot.
 *
 * Returns a short "no context" line rather than "" when there is genuinely
 * nothing to say, because the generate route substitutes "(beginning of
 * document)" for an empty contextAbove, which is true of an editor caret and
 * nonsense in a creation prompt.
 */
export function buildIdeaBrief(input: IdeaBriefInput): string {
  const sections: string[] = [];

  if (input.idea) {
    const lines = [`IDEA: ${input.idea.title.trim() || "Untitled idea"}`];
    const summary = input.idea.summary?.trim();
    if (summary) lines.push(summary);
    sections.push(lines.join("\n"));
  }

  const siblings = [...input.siblings]
    .filter((piece) => piece.body.trim().length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  if (siblings.length > 0) {
    const shown = siblings.slice(0, MAX_SIBLINGS);
    const lines = shown.map(
      (piece) => `- ${pieceLabel(piece)}: ${excerpt(piece.body, SIBLING_EXCERPT_CHARS)}`,
    );
    const hidden = siblings.length - shown.length;
    if (hidden > 0) lines.push(`- (${hidden} more not shown)`);
    sections.push(
      [
        "ALREADY WRITTEN IN THIS IDEA. Build on these and do not repeat them:",
        ...lines,
      ].join("\n"),
    );
  }

  if (input.resources.length > 0) {
    const shown = input.resources.slice(0, MAX_RESOURCES);
    const lines = shown.map((entry) => `- ${resourceLine(entry)}`);
    const hidden = input.resources.length - shown.length;
    if (hidden > 0) lines.push(`- (${hidden} more not shown)`);
    sections.push(["SOURCES THE WRITER ATTACHED:", ...lines].join("\n"));
  }

  if (sections.length === 0) return "(no surrounding context: this is the first thing in a new idea)";
  return sections.join("\n\n");
}
