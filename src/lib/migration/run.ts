import { db } from "@/lib/db";
import type { ContentPiece, Idea } from "@/lib/content-engine";
import type { MigrationRecord, PieceVersion } from "@/lib/types";
import { buildMigrationPlan, type MigrationPlan, type PlanInput } from "./plan";
import { captureSnapshot, storeSnapshot } from "./snapshot";
import { verifyMigration, type VerificationResult } from "./verify";

/**
 * Performing the one-entity migration.
 *
 * Three rules shape this file, and they are the reason it is written the way
 * it is rather than as a straight loop over notes.
 *
 * It is additive. Nothing here deletes a note, a version, or a review. The
 * migration copies text into fragments and leaves every original in place, so
 * the worst case is a library holding two copies of itself, never one holding
 * none. Retiring the old rows is a separate decision made later, once every
 * device has moved across.
 *
 * It is verified before it is kept. The writes and the check run inside one
 * transaction, and a failed check throws, which is how Dexie is told to roll
 * the whole thing back. A library that fails verification is left exactly as
 * it was found.
 *
 * It is deterministic. Two devices running this against the same library
 * produce byte-identical rows under identical ids, so sync merges them into
 * one copy instead of racing.
 */

export const ONE_ENTITY_MIGRATION_ID = "one-entity-v20";

export interface MigrationOutcome {
  status: "complete" | "failed" | "skipped";
  reason?: string;
  plan?: MigrationPlan;
  verification?: VerificationResult;
  snapshotId?: string | null;
}

/** Thrown to roll the transaction back. Never escapes this module. */
class VerificationRefused extends Error {
  constructor(readonly result: VerificationResult) {
    super("migration verification refused");
    this.name = "VerificationRefused";
  }
}

export async function readMigrationRecord(): Promise<MigrationRecord | undefined> {
  return db.migrations.get(ONE_ENTITY_MIGRATION_ID);
}

export async function isOneEntityMigrationComplete(): Promise<boolean> {
  const record = await readMigrationRecord();
  return record?.status === "complete";
}

export async function runOneEntityMigration(options: { force?: boolean } = {}): Promise<MigrationOutcome> {
  const existing = await readMigrationRecord();
  if (existing?.status === "complete" && !options.force) {
    return { status: "skipped", reason: "already migrated on this device" };
  }

  // A backup that failed is a migration that does not start. This is the one
  // ordering in the whole feature with no way back if it is got wrong, so the
  // snapshot is taken unconditionally rather than gated on a version check:
  // by the time this runs the database is already open at the new schema, and
  // "the schema looks current" says nothing about whether the *data* has been
  // reshaped yet.
  const snapshot = await captureSnapshot();
  const snapshotId = snapshot ? await storeSnapshot(snapshot) : null;

  const startedAt = Date.now();
  await db.migrations.put({
    id: ONE_ENTITY_MIGRATION_ID,
    status: "running",
    startedAt,
    snapshotId: snapshotId ?? undefined,
  });

  const input = await readPlanInput();
  const plan = buildMigrationPlan(input);

  try {
    await db.transaction(
      "rw",
      // noteVersions is in scope read-only: the carried-over version rows are
      // copied from it, and Dexie requires every table a transaction touches
      // to be named up front even when it is only read.
      [db.ideas, db.contentPieces, db.noteVersions, db.pieceVersions, db.reviews, db.snippets],
      async () => {
        await writePlan(input, plan);

        // Read back what is actually on disk, inside the same transaction, and
        // grade it against the notes as they were before any of this ran.
        const [pieces, ideas, pieceVersions, reviews, snippets] = await Promise.all([
          db.contentPieces.toArray(),
          db.ideas.toArray(),
          db.pieceVersions.toArray(),
          db.reviews.toArray(),
          db.snippets.toArray(),
        ]);

        const verification = verifyMigration({
          before: input.notes,
          plan,
          pieces,
          ideas,
          noteVersions: pieceVersions.map((row) => ({
            id: row.id,
            noteId: row.legacyNoteId ?? null,
            pieceId: row.pieceId,
          })),
          reviews: reviews.map((row) => ({ id: row.id, noteId: row.noteId, pieceId: row.pieceId })),
          snippets: snippets.map((row) => ({ id: row.id, noteId: row.noteId, pieceId: row.pieceId })),
        });

        if (!verification.ok) throw new VerificationRefused(verification);
      },
    );
  } catch (error) {
    if (error instanceof VerificationRefused) {
      await db.migrations.put({
        id: ONE_ENTITY_MIGRATION_ID,
        status: "failed",
        startedAt,
        finishedAt: Date.now(),
        counts: plan.counts,
        failures: error.result.failures,
        snapshotId: snapshotId ?? undefined,
      });
      return { status: "failed", plan, verification: error.result, snapshotId };
    }

    await db.migrations.put({
      id: ONE_ENTITY_MIGRATION_ID,
      status: "failed",
      startedAt,
      finishedAt: Date.now(),
      counts: plan.counts,
      failures: [
        { code: "threw", subject: "migration", detail: error instanceof Error ? error.message : String(error) },
      ],
      snapshotId: snapshotId ?? undefined,
    });
    throw error;
  }

  await db.migrations.put({
    id: ONE_ENTITY_MIGRATION_ID,
    status: "complete",
    startedAt,
    finishedAt: Date.now(),
    counts: plan.counts,
    snapshotId: snapshotId ?? undefined,
  });

  return { status: "complete", plan, snapshotId };
}

async function readPlanInput(): Promise<PlanInput> {
  const [notes, pieces, ideas, noteVersions, reviews, snippets] = await Promise.all([
    db.notes.toArray(),
    db.contentPieces.toArray(),
    db.ideas.toArray(),
    db.noteVersions.toArray(),
    db.reviews.toArray(),
    db.snippets.toArray(),
  ]);

  return {
    notes,
    pieces,
    ideas,
    noteVersions: noteVersions.map((row) => ({ id: row.id, noteId: row.noteId })),
    reviews: reviews.map((row) => ({ id: row.id, noteId: row.noteId })),
    snippets: snippets.map((row) => ({ id: row.id, noteId: row.noteId })),
  };
}

async function writePlan(input: PlanInput, plan: MigrationPlan): Promise<void> {
  const noteById = new Map(input.notes.map((note) => [note.id, note]));
  const pieceById = new Map(input.pieces.map((piece) => [piece.id, piece]));

  const ideas: Idea[] = [];
  const pieces: ContentPiece[] = [];

  for (const promotion of plan.promotions) {
    const note = noteById.get(promotion.noteId);
    if (!note) continue;

    ideas.push({
      id: promotion.ideaId,
      title: promotion.title,
      parentId: null,
      priority: 0,
      origin: "user",
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });

    pieces.push({
      id: promotion.pieceId,
      ideaId: promotion.ideaId,
      format: "essay",
      status: "in-progress",
      origin: "user",
      title: promotion.title,
      subtitle: note.subtitle,
      body: note.content,
      goal: note.goal,
      audience: note.audience,
      tone: note.tone,
      remember: note.remember,
      voiceId: note.voiceId,
      legacyNoteId: note.id,
      seen: true,
      priority: 0,
      order: 0,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
    });
  }

  for (const absorption of plan.absorptions) {
    const note = noteById.get(absorption.noteId);
    const piece = pieceById.get(absorption.pieceId);
    if (!note || !piece) continue;

    pieces.push({
      ...piece,
      // The note's title is what the writer has been seeing on this draft, so
      // it wins over whatever the linking fragment happened to store.
      title: note.title.trim().length > 0 ? note.title : piece.title,
      subtitle: note.subtitle,
      body: note.content,
      goal: note.goal,
      audience: note.audience,
      tone: note.tone,
      remember: note.remember,
      voiceId: note.voiceId,
      legacyNoteId: note.id,
      noteId: undefined,
    });
  }

  for (const orphan of plan.orphanedPieces) {
    const piece = pieceById.get(orphan.pieceId);
    if (!piece) continue;
    // The note it pointed at is already gone, so there is nothing to recover.
    // An empty body at least leaves an editable fragment rather than a row the
    // UI cannot render.
    pieces.push({ ...piece, body: piece.body ?? "", legacyNoteId: orphan.missingNoteId, noteId: undefined });
  }

  if (ideas.length > 0) await db.ideas.bulkPut(ideas);
  if (pieces.length > 0) await db.contentPieces.bulkPut(pieces);

  await writeVersions(plan);
  await rekeyRows(db.reviews, plan.rekeys.reviews);
  await rekeyRows(db.snippets, plan.rekeys.snippets);
}

async function writeVersions(plan: MigrationPlan): Promise<void> {
  if (plan.rekeys.noteVersions.length === 0) return;

  const targetById = new Map(plan.rekeys.noteVersions.map((row) => [row.id, row.toPieceId]));
  const source = await db.noteVersions.bulkGet([...targetById.keys()]);

  const carried: PieceVersion[] = [];
  for (const version of source) {
    if (!version) continue;
    const pieceId = targetById.get(version.id);
    if (!pieceId) continue;
    // Same id in a new table: deterministic across devices, and the original
    // row stays in noteVersions untouched.
    carried.push({
      id: version.id,
      pieceId,
      legacyNoteId: version.noteId,
      title: version.title,
      subtitle: version.subtitle,
      content: version.content,
      goal: version.goal,
      audience: version.audience,
      tone: version.tone,
      remember: version.remember,
      voiceId: version.voiceId,
      name: version.name,
      trigger: version.trigger,
      wordCount: version.wordCount,
      createdAt: version.createdAt,
    });
  }

  if (carried.length > 0) await db.pieceVersions.bulkPut(carried);
}

/** Stamp pieceId onto satellite rows that keep their table and their id. */
async function rekeyRows<T extends { id: string; pieceId?: string }>(
  table: { bulkGet(keys: string[]): Promise<(T | undefined)[]>; bulkPut(rows: T[]): Promise<unknown> },
  rekeys: { id: string; toPieceId: string }[],
): Promise<void> {
  if (rekeys.length === 0) return;

  const targetById = new Map(rekeys.map((row) => [row.id, row.toPieceId]));
  const rows = await table.bulkGet([...targetById.keys()]);

  const updated: T[] = [];
  for (const row of rows) {
    if (!row) continue;
    const pieceId = targetById.get(row.id);
    if (!pieceId || row.pieceId === pieceId) continue;
    updated.push({ ...row, pieceId });
  }

  if (updated.length > 0) await table.bulkPut(updated);
}
