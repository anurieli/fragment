import type { MigrationRecord } from "@/lib/types";
import { dryRunLive, formatDryRunReport, type DryRunReport } from "./dry-run";
import { readMigrationRecord, runOneEntityMigration, type MigrationOutcome } from "./run";
import {
  captureSnapshot,
  downloadSnapshot,
  listSnapshots,
  readSnapshot,
  restoreSnapshotIntoLibrary,
  type LibrarySnapshot,
  type RestoreResult,
} from "./snapshot";

/**
 * A console handle on the migration tools.
 *
 * A writer's library only exists inside their own browser, so the only place a
 * dry run can be performed against real data is a devtools console on the
 * machine that holds it.
 *
 * Everything here is read-only except migrateNow() and restore(), which say so
 * in their names. The app does not run the migration on its own yet; until the
 * UI can read the new shape, starting it is a deliberate act.
 */

export interface MigrationConsole {
  /** Plan the migration against this library. Writes nothing. */
  dryRun(): Promise<DryRunReport | null>;
  /** Same, printed as text. */
  report(): Promise<string>;
  /** Take a snapshot and hand it over as a file. */
  download(): Promise<void>;
  /** Snapshots stored on this device. */
  snapshots(): Promise<{ id: string; capturedAt: number; schemaVersion: number; rowCounts: Record<string, number> }[]>;
  /** Put a stored snapshot's rows back. */
  restore(id: string): Promise<RestoreResult>;
  /** Run the migration. Takes its own snapshot first, verifies before keeping
   * the result, and rolls back completely if verification refuses. */
  migrateNow(options?: { force?: boolean }): Promise<MigrationOutcome>;
  /** What this device recorded about its last migration attempt. */
  status(): Promise<MigrationRecord | undefined>;
}

const api: MigrationConsole = {
  dryRun: () => dryRunLive(),

  async report() {
    const result = await dryRunLive();
    if (!result) return "No Fragment library on this device.";
    return formatDryRunReport(result);
  },

  async download() {
    const snapshot: LibrarySnapshot | null = await captureSnapshot();
    if (!snapshot) throw new Error("No Fragment library on this device.");
    downloadSnapshot(snapshot);
  },

  snapshots: () => listSnapshots(),

  async restore(id: string) {
    const snapshot = await readSnapshot(id);
    if (!snapshot) throw new Error(`No snapshot with id ${id}. Call snapshots() to list them.`);
    return restoreSnapshotIntoLibrary(snapshot);
  },

  migrateNow: (options = {}) => runOneEntityMigration(options),

  status: () => readMigrationRecord(),
};

declare global {
  interface Window {
    fragmentMigration?: MigrationConsole;
  }
}

export function installMigrationConsole(): void {
  if (typeof window === "undefined") return;
  window.fragmentMigration = api;
}
