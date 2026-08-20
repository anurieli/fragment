import type { ContentPiece, PieceStatus, Priority } from "@/lib/content-engine";
import { pieceAge, staleness } from "@/stores/content-selectors";

// Pure helpers behind the short-form feed (ARI-154). No Zustand, no clocks
// read internally — callers inject `now` so these stay deterministic and
// unit-testable without mocking time. Mirrors the convention already set by
// src/stores/content-selectors.ts.

export const PIECE_FILTERS = ["all", "inbox", "extracted", "in-progress", "ready", "archived"] as const;
export type PieceFilter = (typeof PIECE_FILTERS)[number];

export const PIECE_SORT_MODES = ["newest", "oldest", "priority", "last-edited", "schedule", "manual"] as const;
export type PieceSortMode = (typeof PIECE_SORT_MODES)[number];

/** Sort rank for Priority: urgent (1) first through low (4), none (0) last. */
function priorityRank(priority: Priority): number {
  return priority === 0 ? 5 : priority;
}

/**
 * Live (non-deleted) pieces, optionally narrowed to one status. "all" keeps
 * every status, including published — this is a working view, not a status
 * filter that hides finished work.
 *
 * Archived pieces are the exception to "all": they answer only to their own
 * filter. Archive is how a writer says "stop showing me this", so a view
 * called All that still showed them would make the gesture pointless. That
 * also makes "archived" the one filter here that reads a field rather than a
 * status, which is right — a piece keeps whatever status it had when it was
 * put away, and gets it back on the way out.
 */
export function filterPieces(pieces: readonly ContentPiece[], filter: PieceFilter): ContentPiece[] {
  const live = pieces.filter((p) => p.deletedAt === undefined);
  if (filter === "archived") return live.filter((p) => p.archivedAt !== undefined);
  const current = live.filter((p) => p.archivedAt === undefined);
  if (filter === "extracted") return current.filter((p) => p.reviewQueue === "extraction");
  const active = current.filter((p) => p.reviewQueue === undefined);
  if (filter === "all") return active;
  return active.filter((p) => p.status === filter);
}

export interface PieceFilterCounts {
  all: number;
  inbox: number;
  extracted: number;
  "in-progress": number;
  ready: number;
  archived: number;
}

/** Counts for the filter chips, computed once over the full live set. */
export function filterCounts(pieces: readonly ContentPiece[]): PieceFilterCounts {
  const live = pieces.filter((p) => p.deletedAt === undefined);
  const counts: PieceFilterCounts = {
    all: 0,
    inbox: 0,
    extracted: 0,
    "in-progress": 0,
    ready: 0,
    archived: 0,
  };
  for (const piece of live) {
    if (piece.archivedAt !== undefined) {
      counts.archived += 1;
      continue;
    }
    if (piece.reviewQueue === "extraction") {
      counts.extracted += 1;
      continue;
    }
    counts.all += 1;
    if (piece.status === "inbox") counts.inbox += 1;
    else if (piece.status === "in-progress") counts["in-progress"] += 1;
    else if (piece.status === "ready") counts.ready += 1;
  }
  return counts;
}

/**
 * Orders pieces per the active sort mode. "priority" ties break by oldest
 * createdAt first (matches content-selectors' publishQueue — the "ready"
 * filter's default sort is this mode). "manual" uses the stored `order`
 * field, the same one drag-reorder writes.
 *
 * Pinned pieces float above the rest in every mode except "manual", where the
 * writer has already said where each piece goes by dragging it and a float
 * would silently overrule them. Among themselves, pinned pieces keep the
 * mode's own ordering, so pinning is a promotion rather than a second sort.
 */
export function sortPieces(pieces: readonly ContentPiece[], mode: PieceSortMode): ContentPiece[] {
  const ordered = sortWithinGroup(pieces, mode);
  if (mode === "manual") return ordered;
  const pinned = ordered.filter((p) => p.pinnedAt !== undefined);
  if (pinned.length === 0) return ordered;
  return [...pinned, ...ordered.filter((p) => p.pinnedAt === undefined)];
}

function sortWithinGroup(pieces: readonly ContentPiece[], mode: PieceSortMode): ContentPiece[] {
  const list = pieces.slice();
  switch (mode) {
    case "newest":
      return list.sort((a, b) => b.createdAt - a.createdAt);
    case "oldest":
      return list.sort((a, b) => a.createdAt - b.createdAt);
    case "priority":
      return list.sort((a, b) => {
        const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
        if (rankDiff !== 0) return rankDiff;
        return a.createdAt - b.createdAt;
      });
    case "last-edited":
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    case "schedule":
      // Scheduled pieces first, soonest first; unscheduled trail, newest-first.
      return list.sort((a, b) => {
        if (a.scheduledAt !== undefined && b.scheduledAt !== undefined) {
          return a.scheduledAt - b.scheduledAt;
        }
        if (a.scheduledAt !== undefined) return -1;
        if (b.scheduledAt !== undefined) return 1;
        return b.createdAt - a.createdAt;
      });
    case "manual":
      return list.sort((a, b) => a.order - b.order);
    default:
      return list;
  }
}

/** The "ready" filter is the publish queue: priority first, then oldest first. Every other filter defaults to newest-first. */
export function defaultSortForFilter(filter: PieceFilter): PieceSortMode {
  return filter === "ready" ? "priority" : "newest";
}

/** Applies the filter and its sort in one pass — the shape the feed renders. */
export function visiblePieces(
  pieces: readonly ContentPiece[],
  filter: PieceFilter,
  sort: PieceSortMode,
): ContentPiece[] {
  return sortPieces(filterPieces(pieces, filter), sort);
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "→ Jul 30, 2pm" badge text for a scheduled piece; minutes shown only when non-zero ("2:30pm"). */
export function scheduleLabel(scheduledAt: number): string {
  const d = new Date(scheduledAt);
  const hours24 = d.getHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const suffix = hours24 < 12 ? "am" : "pm";
  const minutes = d.getMinutes();
  const time = minutes === 0 ? `${hours12}${suffix}` : `${hours12}:${String(minutes).padStart(2, "0")}${suffix}`;
  return `→ ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

/** A scheduled time in the past with no publish yet — nudge, never auto-post. */
export function scheduleOverdue(
  piece: Pick<ContentPiece, "scheduledAt" | "status">,
  now: number,
): boolean {
  return piece.scheduledAt !== undefined && piece.scheduledAt < now && piece.status !== "published";
}

/** Compact relative-duration token: "6d", "3h", "12m". Floors to the largest unit that has elapsed. */
export function formatDuration(ms: number): string {
  const clamped = Math.max(0, ms);
  if (clamped >= DAY_MS) return `${Math.floor(clamped / DAY_MS)}d`;
  if (clamped >= HOUR_MS) return `${Math.floor(clamped / HOUR_MS)}h`;
  return `${Math.max(1, Math.floor(clamped / MINUTE_MS))}m`;
}

/** "in inbox 6d" style age token — always visible, keyed off createdAt (how long the piece has existed), independent of the staleness color below. */
export function ageLabel(piece: Pick<ContentPiece, "createdAt">, now: number): string {
  return formatDuration(pieceAge(piece, now));
}

/** "ready 3d" style wait-time token for the publish queue — time since the piece last changed (moving to "ready" bumps updatedAt). */
export function waitLabel(piece: Pick<ContentPiece, "updatedAt">, now: number): string {
  return formatDuration(staleness(piece, now));
}

export const STALE_THRESHOLD_MS = 7 * DAY_MS;
export const IDLE_THRESHOLD_MS = 14 * DAY_MS;

export type StaleLevel = "fresh" | "stale" | "idle";

/**
 * Idle-time color state, driven by updatedAt (not createdAt — a piece an
 * agent keeps redrafting isn't stale even if it's old). "stale" from ~7
 * idle days (faint gold), "idle" from ~14 (stronger gold).
 */
export function stalenessLevel(piece: Pick<ContentPiece, "updatedAt">, now: number): StaleLevel {
  const idleMs = staleness(piece, now);
  if (idleMs >= IDLE_THRESHOLD_MS) return "idle";
  if (idleMs >= STALE_THRESHOLD_MS) return "stale";
  return "fresh";
}

/** Per-filter empty-state copy, one line each, on-brand. */
export const EMPTY_STATE_COPY: Record<PieceFilter, string> = {
  all: "No pieces yet. Snip something out, or drop in a draft from an agent.",
  inbox: "Nothing waiting. Agents drop drafts here — or snip one out yourself.",
  extracted: "Nothing to review. Extract Ideas results wait here before becoming active work.",
  "in-progress": "Nothing in motion. Pull a piece from the inbox to start shaping it.",
  ready: "Nothing queued. Mark a piece ready when it's good to publish.",
  archived: "Nothing put away. Archiving a piece hides it here without deleting a word.",
};

/**
 * Roving-focus index helpers for J/K and arrow navigation within the feed.
 * Clamped, not wraparound — matches other list navigation in the app. A
 * negative currentIndex (nothing focused yet) lands on the first card.
 */
export function rovingNext(currentIndex: number, count: number): number {
  if (count === 0) return -1;
  if (currentIndex < 0) return 0;
  return Math.min(currentIndex + 1, count - 1);
}

export function rovingPrev(currentIndex: number, count: number): number {
  if (count === 0) return -1;
  if (currentIndex < 0) return 0;
  return Math.max(currentIndex - 1, 0);
}

/**
 * PieceStatus cycle used by the "S" key. Deliberately excludes "published" —
 * moving a piece to published requires a PublishRecord (see
 * assertPublishGuard in the content-engine contract), which only exists once
 * the Share flow lands in a later issue. Inbox is also one-way: external work
 * can leave it, but an internal shortcut must never put work back there.
 */
export function nextStatus(current: PieceStatus): PieceStatus {
  if (current === "inbox") return "in-progress";
  if (current === "in-progress") return "ready";
  return "in-progress";
}
