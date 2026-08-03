import { db } from "@/lib/db";
import { SYNCED_COLLECTIONS, type SyncedCollection } from "@/lib/sync/protocol";
import { mergeFromSync, sanitizeForSync, tableFor } from "@/lib/sync/collections";

export const LIBRARY_BACKUP_FORMAT = "fragment-library";
export const LIBRARY_BACKUP_VERSION = 1;

export interface LibraryBackup {
  format: typeof LIBRARY_BACKUP_FORMAT;
  version: typeof LIBRARY_BACKUP_VERSION;
  exportedAt: string;
  collections: Partial<Record<SyncedCollection, Record<string, unknown>[]>>;
}

export async function createLibraryBackup(): Promise<LibraryBackup> {
  const collections: LibraryBackup["collections"] = {};
  for (const collection of SYNCED_COLLECTIONS) {
    const rows = await tableFor(collection).toArray();
    collections[collection] = rows.map((row) => sanitizeForSync(collection, row));
  }
  return {
    format: LIBRARY_BACKUP_FORMAT,
    version: LIBRARY_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    collections,
  };
}

export function parseLibraryBackup(input: string): LibraryBackup {
  const parsed = JSON.parse(input) as Partial<LibraryBackup>;
  if (
    parsed.format !== LIBRARY_BACKUP_FORMAT ||
    parsed.version !== LIBRARY_BACKUP_VERSION ||
    !parsed.collections ||
    typeof parsed.collections !== "object"
  ) {
    throw new Error("That file is not a supported Fragment library backup.");
  }
  return parsed as LibraryBackup;
}

export async function restoreLibraryBackup(backup: LibraryBackup): Promise<number> {
  let imported = 0;
  const tables = SYNCED_COLLECTIONS.map((collection) => tableFor(collection));
  await db.transaction("rw", tables, async () => {
    for (const collection of SYNCED_COLLECTIONS) {
      const rows = backup.collections[collection];
      if (!Array.isArray(rows)) continue;
      const table = tableFor(collection);
      for (const incoming of rows) {
        if (!incoming || typeof incoming !== "object" || typeof incoming.id !== "string") continue;
        const local = await table.get(incoming.id);
        const merged = mergeFromSync(collection, incoming, local);
        await table.put({ ...merged, id: incoming.id });
        imported++;
      }
    }
  });
  return imported;
}

export function downloadLibraryBackup(backup: LibraryBackup): void {
  const date = backup.exportedAt.slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `fragment-library-${date}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
