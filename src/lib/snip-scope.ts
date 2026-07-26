import type { Snippet } from "./types";

/**
 * Which bucket a snippet's `order` counts within, and which surface it comes
 * home to.
 *
 * The Snip Bar used to be note-scoped, full stop: it showed
 * `snippet.noteId === activeNoteId` and nothing else. That worked while every
 * snippet came out of the long-form editor, and broke the moment you could
 * snip from a short-form piece — a piece has no note, so the snippet was
 * either refused outright or filed against whatever note happened to be open,
 * which is a note you are not looking at. Either way the Snip Bar stayed
 * empty and the gesture read as broken.
 *
 * So a snippet now has one of two homes: a note (cut from a draft) or an idea
 * (cut from a piece). `order` is sequential within a home, never across the
 * two.
 */
export function snippetHome(snippet: Pick<Snippet, "noteId" | "ideaId">): string | null {
  if (snippet.noteId) return `note:${snippet.noteId}`;
  if (snippet.ideaId) return `idea:${snippet.ideaId}`;
  return null;
}

/** The home key for a snippet about to be created. */
export function snipHomeKey(noteId: string | null, ideaId: string | undefined): string | null {
  return snippetHome({ noteId, ideaId });
}

/**
 * Is this snippet on screen right now?
 *
 * Both homes are visible at once while you're inside an idea with one of its
 * drafts open: snips off the draft and snips off the pieces are the same
 * pile of parts, and switching Write <-> Pieces shouldn't empty the bar.
 */
export function isSnippetVisible(
  snippet: Pick<Snippet, "noteId" | "ideaId">,
  activeNoteId: string | null,
  activeIdeaId: string | null,
): boolean {
  if (activeNoteId && snippet.noteId === activeNoteId) return true;
  if (activeIdeaId && snippet.ideaId === activeIdeaId) return true;
  return false;
}

/** The visible snippets, in bar order. createdAt breaks ties across homes. */
export function visibleSnippets(
  snippets: Record<string, Snippet> | readonly Snippet[],
  activeNoteId: string | null,
  activeIdeaId: string | null,
): Snippet[] {
  const all = Array.isArray(snippets) ? snippets : Object.values(snippets);
  return (all as Snippet[])
    .filter((s) => isSnippetVisible(s, activeNoteId, activeIdeaId))
    .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt);
}
