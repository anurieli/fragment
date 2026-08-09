import { dryRunLive, formatDryRunReport, type DryRunReport } from "./dry-run";
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
 * machine that holds it. This exposes exactly the read-only tools plus the
 * recovery path, and nothing that performs the migration: deciding to migrate
 * stays with the app, not with whoever is typing into a console.
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
