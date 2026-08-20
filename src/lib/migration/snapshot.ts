import Dexie from "dexie";

/**
 * A complete copy of the library, taken before the schema is allowed to change.
 *
 * Dexie runs upgrade callbacks the moment the database is opened, so anything
 * that wants to see the old shape has to look before the app's own connection
 * is established. That is what this module is: it opens the existing database
 * in Dexie's dynamic mode, which adopts whatever schema is already on disk
 * rather than declaring one, reads every table, and writes the result somewhere
 * the migration cannot reach.
 *
 * The snapshot lives in its own IndexedDB database. Keeping it inside
 * `fragment` would mean the one artifact that can undo a bad migration shares a
 * fate with the thing it is insuring against.
 */

const LIBRARY_DB = "fragment";
const BACKUP_DB = "fragment-migration-backup";
export const SNAPSHOT_FORMAT = "fragment-pre-migration";
export const SNAPSHOT_VERSION = 1;

/** How many snapshots to keep. Enough to survive a bad upgrade followed by a
 * bad recovery attempt, not so many that a large library fills the origin's
 * storage quota. */
const KEEP_SNAPSHOTS = 3;

export interface LibrarySnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: typeof SNAPSHOT_VERSION;
  /** Dexie schema version the library was on when this was taken. */
  schemaVersion: number;
  capturedAt: number;
  tables: Record<string, Record<string, unknown>[]>;
  rowCounts: Record<string, number>;
}

interface SnapshotRow extends LibrarySnapshot {
  id: string;
}

class BackupDB extends Dexie {
  snapshots!: Dexie.Table<SnapshotRow, string>;

  constructor() {
    super(BACKUP_DB);
    this.version(1).stores({ snapshots: "id, capturedAt" });
  }
}

let backupDb: BackupDB | null = null;

function getBackupDb(): BackupDB {
  if (!backupDb) backupDb = new BackupDB();
  return backupDb;
}

/** Drop the cached connection. Tests that delete the backup database need this;
 * an open handle turns a delete into a blocked request. */
export function closeMigrationBackupDb(): void {
  backupDb?.close();
  backupDb = null;
}

/**
 * Open the library exactly as it exists on disk, with no schema of our own.
 *
 * The caller owns closing it. Holding this connection open blocks the app's
 * own upgrade, which is precisely the point while a snapshot is in flight.
 */
async function openRawLibrary(): Promise<Dexie | null> {
  const exists = await Dexie.exists(LIBRARY_DB);
  if (!exists) return null;
  const raw = new Dexie(LIBRARY_DB);
  await raw.open();
  return raw;
}

/** The Dexie version currently on disk, or 0 when there is no library yet. */
export async function readInstalledSchemaVersion(): Promise<number> {
  const raw = await openRawLibrary();
  if (!raw) return 0;
  try {
    return raw.verno;
  } finally {
    raw.close();
  }
}

export async function captureSnapshot(): Promise<LibrarySnapshot | null> {
  const raw = await openRawLibrary();
  if (!raw) return null;

  try {
    const tables: LibrarySnapshot["tables"] = {};
    const rowCounts: LibrarySnapshot["rowCounts"] = {};
    for (const table of raw.tables) {
      const rows = (await table.toArray()) as Record<string, unknown>[];
      tables[table.name] = rows;
      rowCounts[table.name] = rows.length;
    }
    return {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      schemaVersion: raw.verno,
      capturedAt: Date.now(),
      tables,
      rowCounts,
    };
  } finally {
    raw.close();
  }
}

export async function storeSnapshot(snapshot: LibrarySnapshot): Promise<string> {
  const id = `pre-v${snapshot.schemaVersion}-${snapshot.capturedAt}`;
  const db = getBackupDb();
  await db.snapshots.put({ ...snapshot, id });

  const all = await db.snapshots.orderBy("capturedAt").toArray();
  const stale = all.slice(0, Math.max(0, all.length - KEEP_SNAPSHOTS));
  if (stale.length > 0) await db.snapshots.bulkDelete(stale.map((row) => row.id));

  return id;
}

export async function listSnapshots(): Promise<{ id: string; capturedAt: number; schemaVersion: number; rowCounts: Record<string, number> }[]> {
  const rows = await getBackupDb().snapshots.orderBy("capturedAt").reverse().toArray();
  return rows.map(({ id, capturedAt, schemaVersion, rowCounts }) => ({ id, capturedAt, schemaVersion, rowCounts }));
}

export async function readSnapshot(id: string): Promise<LibrarySnapshot | null> {
  const row = await getBackupDb().snapshots.get(id);
  return row ?? null;
}

/**
 * Take a snapshot if the library is older than the schema we are about to
 * install, and there is not already one for that version.
 *
 * Returns the snapshot id, or null when nothing needed capturing: a fresh
 * install, an already-migrated library, or a repeat call within one session.
 * Throws if the capture fails, and callers must let that propagate. A
 * migration that proceeds after its own backup failed is the one sequence with
 * no way back.
 */
export async function ensurePreMigrationBackup(targetSchemaVersion: number): Promise<string | null> {
  const installed = await readInstalledSchemaVersion();
  if (installed === 0 || installed >= targetSchemaVersion) return null;

  const existing = await getBackupDb().snapshots.where("capturedAt").above(0).toArray();
  const alreadyHave = existing.find((row) => row.schemaVersion === installed);
  if (alreadyHave) return alreadyHave.id;

  const snapshot = await captureSnapshot();
  if (!snapshot) return null;
  return storeSnapshot(snapshot);
}

export interface RestoreResult {
  restored: Record<string, number>;
  /** Tables the snapshot holds that the library no longer has. Reported rather
   * than treated as an error: after the notes table is finally retired, a
   * pre-migration snapshot legitimately carries rows with nowhere to go. */
  skipped: string[];
}

/**
 * Write a snapshot's rows back into the library.
 *
 * This is the recovery path, and it is deliberately narrow: it restores rows
 * into tables that still exist and refuses to invent ones that do not. The
 * migration's real protection is that it never retires a note until the
 * verification gate has passed, so the common failure is "abort and keep the
 * old rows", not "put everything back". This exists for the uncommon one.
 */
export async function restoreSnapshotIntoLibrary(snapshot: LibrarySnapshot): Promise<RestoreResult> {
  const raw = await openRawLibrary();
  if (!raw) throw new Error("There is no Fragment library on this device to restore into.");

  try {
    const available = new Set(raw.tables.map((table) => table.name));
    const restored: Record<string, number> = {};
    const skipped: string[] = [];

    for (const [name, rows] of Object.entries(snapshot.tables)) {
      if (!available.has(name)) {
        skipped.push(name);
        continue;
      }
      if (rows.length === 0) {
        restored[name] = 0;
        continue;
      }
      await raw.table(name).bulkPut(rows);
      restored[name] = rows.length;
    }

    return { restored, skipped };
  } finally {
    raw.close();
  }
}

/** Serialize a snapshot for the writer to keep off-device. */
export function snapshotToJson(snapshot: LibrarySnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

/** Browser-only: hand the snapshot to the writer as a file. */
export function downloadSnapshot(snapshot: LibrarySnapshot): void {
  const date = new Date(snapshot.capturedAt).toISOString().slice(0, 10);
  const blob = new Blob([snapshotToJson(snapshot)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fragment-before-migration-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
