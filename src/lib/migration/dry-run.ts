import type { ContentPiece, Idea } from "@/lib/content-engine";
import type { Note } from "@/lib/types";
import { buildMigrationPlan, describePlan, type MigrationPlan, type PlanInput, type SatelliteRow } from "./plan";
import { captureSnapshot, type LibrarySnapshot } from "./snapshot";

/**
 * Running the migration on paper.
 *
 * The plan is computed from the same rows the real migration will read, and
 * nothing is written. The point is that the writer, and whoever is reviewing
 * the rollout, can see the exact shape of the change against a real library
 * before agreeing to it: how many notes become ideas, how many fold into
 * fragments that already existed, and whether anything is unreadable.
 */

export interface DryRunReport {
  schemaVersion: number;
  capturedAt: number;
  plan: MigrationPlan;
  /** Rows the snapshot held that did not have the shape their table promises.
   * Counted rather than dropped silently, because an unreadable row is the one
   * thing a dry run exists to surface. */
  unreadable: Record<string, number>;
  summary: string;
}

export function dryRunFromSnapshot(snapshot: LibrarySnapshot): DryRunReport {
  const unreadable: Record<string, number> = {};

  const notes = collect<Note>(snapshot, "notes", isNote, unreadable);
  const pieces = collect<ContentPiece>(snapshot, "contentPieces", isPiece, unreadable);
  const ideas = collect<Idea>(snapshot, "ideas", isIdea, unreadable);
  const noteVersions = collect<SatelliteRow>(snapshot, "noteVersions", isSatellite, unreadable);
  const reviews = collect<SatelliteRow>(snapshot, "reviews", isSatellite, unreadable);
  const snippets = collect<SatelliteRow>(snapshot, "snippets", isSatellite, unreadable);

  const input: PlanInput = { notes, pieces, ideas, noteVersions, reviews, snippets };
  const plan = buildMigrationPlan(input);

  return {
    schemaVersion: snapshot.schemaVersion,
    capturedAt: snapshot.capturedAt,
    plan,
    unreadable,
    summary: describePlan(plan),
  };
}

/** Snapshot the live library and plan against it. Writes nothing to `fragment`. */
export async function dryRunLive(): Promise<DryRunReport | null> {
  const snapshot = await captureSnapshot();
  if (!snapshot) return null;
  return dryRunFromSnapshot(snapshot);
}

function collect<T>(
  snapshot: LibrarySnapshot,
  table: string,
  guard: (row: Record<string, unknown>) => boolean,
  unreadable: Record<string, number>,
): T[] {
  const rows = snapshot.tables[table];
  if (!Array.isArray(rows)) return [];
  const kept: T[] = [];
  let rejected = 0;
  for (const row of rows) {
    if (row && typeof row === "object" && guard(row)) kept.push(row as T);
    else rejected++;
  }
  if (rejected > 0) unreadable[table] = rejected;
  return kept;
}

function isNote(row: Record<string, unknown>): boolean {
  return typeof row.id === "string" && typeof row.content === "string" && typeof row.title === "string";
}

function isPiece(row: Record<string, unknown>): boolean {
  return typeof row.id === "string" && typeof row.ideaId === "string" && typeof row.createdAt === "number";
}

function isIdea(row: Record<string, unknown>): boolean {
  return typeof row.id === "string" && typeof row.title === "string";
}

function isSatellite(row: Record<string, unknown>): boolean {
  return typeof row.id === "string" && (typeof row.noteId === "string" || row.noteId === null);
}

/** A plain-text report, for a console, a log line, or a support conversation. */
export function formatDryRunReport(report: DryRunReport): string {
  const { plan } = report;
  const lines = [
    `Fragment one-entity migration, dry run`,
    `Library schema v${report.schemaVersion}, read ${new Date(report.capturedAt).toISOString()}`,
    ``,
    `Notes examined              ${plan.counts.notes}`,
    `  becoming new ideas        ${plan.counts.promotions}`,
    `  folding into fragments    ${plan.counts.absorptions}`,
    `  copied to a 2nd fragment  ${plan.counts.duplicates}`,
    `  empty, carried over       ${plan.counts.emptyNotes}`,
    ``,
    `Satellite rows re-keyed`,
    `  versions                  ${plan.counts.noteVersions}`,
    `  reviews                   ${plan.counts.reviews}`,
    `  snips                     ${plan.counts.snippets}`,
    ``,
    `Already-orphaned satellites ${plan.counts.unmappedSatellites} (left untouched)`,
    `Fragments with a lost note  ${plan.counts.orphanedPieces}`,
  ];

  const unreadable = Object.entries(report.unreadable);
  if (unreadable.length > 0) {
    lines.push(``, `Unreadable rows skipped:`);
    for (const [table, count] of unreadable) lines.push(`  ${table.padEnd(24)}  ${count}`);
  }

  return lines.join("\n");
}
