import type { ContentPiece, Idea, PieceStatus, Priority } from "@/lib/content-engine";

// Pure selectors over the content-engine store's arrays. No Zustand, no
// clocks read internally — callers inject `now` so these stay deterministic
// and unit-testable without mocking time.

/**
 * Sort rank for Priority: urgent (1) first through low (4), none (0) last.
 * Linear's convention inverted only for "none", which always sorts behind
 * every explicit priority.
 */
function priorityRank(priority: Priority): number {
  return priority === 0 ? 5 : priority;
}

/**
 * Pieces ready to publish, sorted priority-first (1 urgent .. 4 low, then 0
 * none), ties broken by oldest createdAt first (longest-waiting piece surfaces
 * first within the same priority).
 */
export function publishQueue(pieces: readonly ContentPiece[]): ContentPiece[] {
  return pieces
    .filter((piece) => piece.status === "ready" && piece.deletedAt === undefined)
    .slice()
    .sort((a, b) => {
      const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      return a.createdAt - b.createdAt;
    });
}

/** How long a piece has existed, in ms. */
export function pieceAge(piece: Pick<ContentPiece, "createdAt">, now: number): number {
  return Math.max(0, now - piece.createdAt);
}

/** How long a piece has sat untouched, in ms (idle time since last edit). */
export function staleness(piece: Pick<ContentPiece, "updatedAt">, now: number): number {
  return Math.max(0, now - piece.updatedAt);
}

/**
 * Pieces edited within the last `windowMs`, most-recently-edited first.
 * "Recently edited" is independent of status — a piece can be worked on in
 * any column.
 */
export function workingOn(
  pieces: readonly ContentPiece[],
  now: number,
  windowMs: number,
): ContentPiece[] {
  return pieces
    .filter((piece) => piece.deletedAt === undefined && now - piece.updatedAt <= windowMs)
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Idea ordering for the sidebar: pinned ideas first (most-recently-pinned
 * first), then unpinned ideas by priority, then by most-recently-updated.
 */
export function pinnedFirst(ideas: readonly Idea[]): Idea[] {
  return ideas
    .filter((idea) => idea.deletedAt === undefined)
    .slice()
    .sort((a, b) => {
      const aPinned = a.pinnedAt !== undefined;
      const bPinned = b.pinnedAt !== undefined;
      if (aPinned !== bPinned) return aPinned ? -1 : 1;
      if (aPinned && bPinned && a.pinnedAt !== b.pinnedAt) {
        return (b.pinnedAt as number) - (a.pinnedAt as number);
      }
      const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      return b.updatedAt - a.updatedAt;
    });
}

/**
 * An idea's pieces, including the pieces of its direct child ideas (nesting
 * is capped at depth 2 by the contract, so one level of children is the
 * entire hierarchy below `ideaId`).
 */
export function hierarchyRollup(
  ideaId: string,
  ideas: readonly Idea[],
  pieces: readonly ContentPiece[],
): ContentPiece[] {
  const ownerIds = new Set<string>([ideaId]);
  for (const idea of ideas) {
    if (idea.parentId === ideaId && idea.deletedAt === undefined) {
      ownerIds.add(idea.id);
    }
  }
  return pieces.filter(
    (piece) => piece.deletedAt === undefined && ownerIds.has(piece.ideaId),
  );
}

/**
 * Short-form pieces only — the ones whose text lives inline (body). A piece
 * that links a Note instead (noteId) is a long-form draft: it belongs to the
 * idea's Write space, not its pieces feed, and its text is edited in the
 * editor rather than in a card textarea.
 */
export function shortformOnly(pieces: readonly ContentPiece[]): ContentPiece[] {
  return pieces.filter((piece) => piece.body !== undefined);
}

/**
 * An idea's long-form drafts (the pieces linking a Note), oldest first so the
 * first draft created stays the idea's primary one across sessions.
 */
export function draftsForIdea(
  ideaId: string,
  pieces: readonly ContentPiece[],
): ContentPiece[] {
  return pieces
    .filter(
      (piece) =>
        piece.deletedAt === undefined &&
        piece.ideaId === ideaId &&
        piece.noteId !== undefined,
    )
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Count of an idea's own (non-rolled-up) pieces per status, e.g. inbox count. */
export function pieceCountsForIdea(
  ideaId: string,
  pieces: readonly ContentPiece[],
): Record<PieceStatus, number> {
  const counts: Record<PieceStatus, number> = {
    inbox: 0,
    "in-progress": 0,
    ready: 0,
    published: 0,
  };
  for (const piece of pieces) {
    if (piece.deletedAt !== undefined || piece.ideaId !== ideaId) continue;
    counts[piece.status] += 1;
  }
  return counts;
}
