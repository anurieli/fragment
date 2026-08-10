import type { Snippet } from "./types";

/**
 * Which bucket a snippet's `order` counts within, and which surface it comes
 * home to.
 *
 * The Snip Bar used to be scoped to one document, full stop: it showed the
 * snips cut from whatever was open in the editor and nothing else. That worked
 * while the editor was the only place text lived, and broke the moment you
 * could snip from a card in the feed, because the snip was either refused
 * outright or filed against the document you were not looking at. Either way
 * the Snip Bar stayed empty and the gesture read as broken.
 *
 * So a snippet has one of two homes: a fragment (cut out of its text) or an
 * idea (cut somewhere no single fragment owns). `order` is sequential within a
 * home, never across the two.
 */
export function snippetHome(snippet: Pick<Snippet, "pieceId" | "ideaId">): string | null {
  if (snippet.pieceId) return `piece:${snippet.pieceId}`;
  if (snippet.ideaId) return `idea:${snippet.ideaId}`;
  return null;
}

/** The home key for a snippet about to be created. */
export function snipHomeKey(pieceId: string | null, ideaId: string | undefined): string | null {
  return snippetHome({ pieceId: pieceId ?? undefined, ideaId });
}

/**
 * Is this snippet on screen right now?
 *
 * Both homes are visible at once while you are inside an idea with one of its
 * fragments open: snips off that fragment and snips off the idea's other
 * fragments are the same pile of parts, and crossing Write to Pieces should
 * not empty the bar.
 */
export function isSnippetVisible(
  snippet: Pick<Snippet, "pieceId" | "ideaId">,
  activePieceId: string | null,
  activeIdeaId: string | null,
): boolean {
  if (activePieceId && snippet.pieceId === activePieceId) return true;
  if (activeIdeaId && snippet.ideaId === activeIdeaId) return true;
  return false;
}

/** The visible snippets, in bar order. createdAt breaks ties across homes. */
export function visibleSnippets(
  snippets: Record<string, Snippet> | readonly Snippet[],
  activePieceId: string | null,
  activeIdeaId: string | null,
): Snippet[] {
  const all = Array.isArray(snippets) ? snippets : Object.values(snippets);
  return (all as Snippet[])
    .filter((s) => isSnippetVisible(s, activePieceId, activeIdeaId))
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}
