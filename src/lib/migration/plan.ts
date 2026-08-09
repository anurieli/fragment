import type { ContentPiece, Idea } from "@/lib/content-engine";
import type { Note } from "@/lib/types";
import { titleFromText } from "@/lib/derive-title";

/**
 * Deciding what the one-entity migration will do, without doing any of it.
 *
 * Every write the migration performs is derived from a plan built here, and the
 * plan is a pure function of the rows it is handed. That buys three things: the
 * same input produces the same plan on every device (which is what makes the
 * deterministic ids below safe under sync), the plan can be computed and shown
 * to the writer before anything is touched, and the verification gate can check
 * the result against the plan rather than against a second guess at the rules.
 */

/** Prefix for the idea minted to hold a note that belonged to no idea. */
export const MIGRATED_IDEA_PREFIX = "mig-";
/** Prefix for the fragment minted to hold that note's text. */
export const MIGRATED_PIECE_PREFIX = "migp-";

export function migratedIdeaId(noteId: string): string {
  return `${MIGRATED_IDEA_PREFIX}${noteId}`;
}

export function migratedPieceId(noteId: string): string {
  return `${MIGRATED_PIECE_PREFIX}${noteId}`;
}

/**
 * A note that no live fragment points at. It becomes an idea of its own,
 * holding a single long-form fragment: the smallest structure that can carry a
 * standalone note once notes no longer exist as a separate thing.
 */
export interface NotePromotion {
  noteId: string;
  ideaId: string;
  pieceId: string;
  title: string;
  /** True when the title came from the note's first line because it had none. */
  titleDerived: boolean;
  bodyLength: number;
  empty: boolean;
}

/**
 * A note that a fragment already points at. The fragment absorbs the note's
 * text and context fields; no new idea is created and the fragment keeps its
 * id, its idea, and its position in the feed.
 */
export interface NoteAbsorption {
  noteId: string;
  pieceId: string;
  ideaId: string;
  bodyLength: number;
  /** True for a fragment inside a deleted idea. See duplicateOf below. */
  tombstoned: boolean;
  /**
   * Set when another fragment is the primary absorber of the same note and
   * this one receives a copy. Two ideas could each hold a draft backed by one
   * note; one entity per fragment means the shared text has to become two
   * copies, which is the only outcome here that is not loss-free reversible.
   */
  duplicateOf?: string;
}

/** A fragment whose noteId points at a note that is not in the table. */
export interface OrphanedPiece {
  pieceId: string;
  missingNoteId: string;
}

/** A satellite row moving from a note key to a fragment key. */
export interface Rekey {
  id: string;
  fromNoteId: string;
  toPieceId: string;
}

export interface MigrationPlan {
  promotions: NotePromotion[];
  absorptions: NoteAbsorption[];
  /** Notes a fragment already holds, because the migration has run here or the
   * result arrived by sync. Re-verified, never re-created. */
  alreadyHeld: { noteId: string; pieceId: string }[];
  orphanedPieces: OrphanedPiece[];
  rekeys: {
    noteVersions: Rekey[];
    reviews: Rekey[];
    snippets: Rekey[];
  };
  /** Every note id mapped to the fragment that will hold its text. */
  noteToPiece: Record<string, string>;
  counts: {
    notes: number;
    promotions: number;
    absorptions: number;
    duplicates: number;
    orphanedPieces: number;
    alreadyHeld: number;
    emptyNotes: number;
    noteVersions: number;
    reviews: number;
    snippets: number;
    /** Satellite rows whose note is gone, so they have nowhere to land. */
    unmappedSatellites: number;
  };
}

/** The satellite shapes the planner needs. Narrow on purpose, so the planner
 * does not depend on the full row types and can run against a raw snapshot. */
export interface SatelliteRow {
  id: string;
  noteId: string | null;
}

export interface PlanInput {
  notes: readonly Note[];
  pieces: readonly ContentPiece[];
  ideas: readonly Idea[];
  noteVersions: readonly SatelliteRow[];
  reviews: readonly SatelliteRow[];
  snippets: readonly SatelliteRow[];
}

/**
 * Order two rows the same way on every device.
 *
 * When two fragments link one note, whichever is older is the primary absorber
 * and the other takes a copy. Two devices running this independently have to
 * reach the same answer or they will sync two different libraries at each
 * other, so the tie-break falls through to the id, which is stable everywhere.
 */
function byAgeThenId(a: { createdAt: number; id: string }, b: { createdAt: number; id: string }): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** First non-empty line of markdown, for a note that never got a title. Shared
 * with the capture gesture so a writer never sees two different derivations of
 * the same words. */
export const deriveTitle = titleFromText;

export function buildMigrationPlan(input: PlanInput): MigrationPlan {
  const noteById = new Map(input.notes.map((note) => [note.id, note]));

  // Every piece that claims a note. Live fragments sort ahead of tombstoned
  // ones, then oldest first, so the primary absorber for a shared note is both
  // deterministic and visible: satellites must never follow their note into a
  // fragment sitting inside a deleted idea.
  const linking = input.pieces
    .filter((piece): piece is ContentPiece & { noteId: string } => typeof piece.noteId === "string" && piece.noteId.length > 0)
    .slice()
    .sort((a, b) => {
      const aDead = a.deletedAt === undefined ? 0 : 1;
      const bDead = b.deletedAt === undefined ? 0 : 1;
      if (aDead !== bDead) return aDead - bDead;
      return byAgeThenId(a, b);
    });

  // Fragments that already carry a note's text, either because this device has
  // migrated before or because another device's result arrived by sync. The
  // bookkeeping row that records "migrated" is local-only, so it can be absent
  // on a device whose *data* is already migrated. Reading the state off the
  // rows themselves is what makes re-running safe instead of duplicating.
  const heldBy = new Map<string, string>();
  for (const piece of input.pieces.slice().sort((a, b) => {
    const aDead = a.deletedAt === undefined ? 0 : 1;
    const bDead = b.deletedAt === undefined ? 0 : 1;
    if (aDead !== bDead) return aDead - bDead;
    return byAgeThenId(a, b);
  })) {
    if (typeof piece.legacyNoteId === "string" && !heldBy.has(piece.legacyNoteId)) {
      heldBy.set(piece.legacyNoteId, piece.id);
    }
  }

  const absorptions: NoteAbsorption[] = [];
  const orphanedPieces: OrphanedPiece[] = [];
  const noteToPiece: Record<string, string> = {};
  /** Note ids that at least one *live* fragment holds, so they need no idea. */
  const claimedLive = new Set<string>();
  const primaryFor = new Map<string, string>();

  for (const piece of linking) {
    const note = noteById.get(piece.noteId);
    if (!note) {
      orphanedPieces.push({ pieceId: piece.id, missingNoteId: piece.noteId });
      continue;
    }
    if (heldBy.has(piece.noteId)) continue;

    const tombstoned = piece.deletedAt !== undefined;
    const primary = primaryFor.get(piece.noteId);
    if (primary === undefined) {
      primaryFor.set(piece.noteId, piece.id);
      // Satellites follow the primary absorber, and so does the note mapping.
      noteToPiece[piece.noteId] = piece.id;
    }

    // A tombstoned fragment still takes the text. Its idea can be restored, and
    // restoring it to an empty draft would be the data loss this migration
    // exists to avoid.
    if (!tombstoned) claimedLive.add(piece.noteId);

    absorptions.push({
      noteId: piece.noteId,
      pieceId: piece.id,
      ideaId: piece.ideaId,
      bodyLength: note.content.length,
      tombstoned,
      duplicateOf: primary === undefined ? undefined : primary,
    });
  }

  const promotions: NotePromotion[] = [];
  const alreadyHeld: MigrationPlan["alreadyHeld"] = [];
  for (const note of input.notes.slice().sort(byAgeThenId)) {
    const holder = heldBy.get(note.id);
    if (holder !== undefined) {
      alreadyHeld.push({ noteId: note.id, pieceId: holder });
      noteToPiece[note.id] = holder;
      continue;
    }
    if (claimedLive.has(note.id)) continue;

    const titleDerived = note.title.trim().length === 0;
    const pieceId = migratedPieceId(note.id);
    promotions.push({
      noteId: note.id,
      ideaId: migratedIdeaId(note.id),
      pieceId,
      title: titleDerived ? deriveTitle(note.content) : note.title,
      titleDerived,
      bodyLength: note.content.length,
      empty: note.content.trim().length === 0 && note.title.trim().length === 0,
    });
    // A note whose only claim came from a deleted idea is promoted *and* left
    // in that tombstoned fragment. The promotion is the copy the writer will
    // actually see, so it takes over as primary: it owns the satellites, and
    // the tombstoned fragment is demoted to a copy of it.
    const displaced = primaryFor.get(note.id);
    if (displaced !== undefined) {
      for (const row of absorptions) {
        if (row.noteId === note.id && row.duplicateOf === undefined) row.duplicateOf = pieceId;
      }
    }
    noteToPiece[note.id] = pieceId;
  }

  const rekeys = {
    noteVersions: mapSatellites(input.noteVersions, noteToPiece),
    reviews: mapSatellites(input.reviews, noteToPiece),
    snippets: mapSatellites(input.snippets, noteToPiece),
  };

  const unmappedSatellites =
    countUnmapped(input.noteVersions, noteToPiece) +
    countUnmapped(input.reviews, noteToPiece) +
    countUnmapped(input.snippets, noteToPiece);

  return {
    promotions,
    absorptions,
    alreadyHeld,
    orphanedPieces,
    rekeys,
    noteToPiece,
    counts: {
      notes: input.notes.length,
      promotions: promotions.length,
      absorptions: absorptions.length,
      duplicates: absorptions.filter((row) => row.duplicateOf !== undefined).length,
      orphanedPieces: orphanedPieces.length,
      alreadyHeld: alreadyHeld.length,
      emptyNotes: promotions.filter((row) => row.empty).length,
      noteVersions: rekeys.noteVersions.length,
      reviews: rekeys.reviews.length,
      snippets: rekeys.snippets.length,
      unmappedSatellites,
    },
  };
}

function mapSatellites(rows: readonly SatelliteRow[], noteToPiece: Record<string, string>): Rekey[] {
  const mapped: Rekey[] = [];
  for (const row of rows) {
    if (!row.noteId) continue;
    const toPieceId = noteToPiece[row.noteId];
    if (!toPieceId) continue;
    mapped.push({ id: row.id, fromNoteId: row.noteId, toPieceId });
  }
  return mapped;
}

/**
 * Satellites pointing at a note that no longer exists.
 *
 * These are already broken today: a version or review whose note was deleted
 * is unreachable in the UI. The migration leaves them untouched rather than
 * inventing a home for them, and the count is reported so the number is a
 * known quantity instead of a silent drop.
 */
function countUnmapped(rows: readonly SatelliteRow[], noteToPiece: Record<string, string>): number {
  let count = 0;
  for (const row of rows) {
    if (!row.noteId) continue;
    if (!noteToPiece[row.noteId]) count++;
  }
  return count;
}

/** A short human summary, used by the dry-run report and the migration log. */
export function describePlan(plan: MigrationPlan): string {
  const { counts } = plan;
  const lines = [
    `${counts.notes} notes examined`,
    `${counts.promotions} become new ideas`,
    `${counts.absorptions} fold into fragments that already linked them`,
    `${counts.noteVersions + counts.reviews + counts.snippets} satellite rows re-keyed`,
  ];
  if (counts.alreadyHeld > 0) lines.push(`${counts.alreadyHeld} already held by a fragment, re-checked only`);
  if (counts.duplicates > 0) lines.push(`${counts.duplicates} copied into a second fragment`);
  if (counts.orphanedPieces > 0) lines.push(`${counts.orphanedPieces} fragments point at a missing note`);
  if (counts.emptyNotes > 0) lines.push(`${counts.emptyNotes} empty notes carried over`);
  if (counts.unmappedSatellites > 0) lines.push(`${counts.unmappedSatellites} satellite rows already orphaned, left alone`);
  return lines.join(", ");
}
