import type { Table } from "dexie";
import { db } from "@/lib/db";
import { SYNCED_COLLECTIONS, type SyncedCollection } from "./protocol";

/**
 * How a synced collection maps onto its local table, and what may leave the
 * device.
 *
 * Sync is not "upload the row". Some records carry material that belongs to
 * this machine and must never reach a server, and uploading it because it
 * happened to share a table with syncable data would be a quiet betrayal of
 * the person using a local-first app.
 */

type AnyRow = Record<string, unknown> & { id: string };

export function tableFor(collection: SyncedCollection): Table<AnyRow, string> {
  return db[collection] as unknown as Table<AnyRow, string>;
}

export function isSyncableTableName(name: string): name is SyncedCollection {
  return (SYNCED_COLLECTIONS as readonly string[]).includes(name);
}

/**
 * Fields stripped on the way out, per collection.
 *
 * `providerCredentials` holds the user's own OpenAI, Anthropic and OpenRouter
 * keys. Fragment's whole pitch is bring-your-own-key, and a key the user
 * pasted into their own machine has no business being copied into our
 * database: it would turn a writing sync feature into a credential store,
 * with the breach surface that implies. The rest of settings — writing style,
 * profile, feature preferences — is exactly the kind of thing you want to
 * find already configured on a second device.
 */
const STRIPPED_FIELDS: Partial<Record<SyncedCollection, string[]>> = {
  settings: ["providerCredentials"],
};

/** The version of a record that is safe to send. */
export function sanitizeForSync(
  collection: SyncedCollection,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = STRIPPED_FIELDS[collection];
  if (!stripped || stripped.length === 0) return row;

  const copy = { ...row };
  for (const field of stripped) delete copy[field];
  return copy;
}

/**
 * Fold an incoming record into what is already stored.
 *
 * The mirror of sanitizeForSync: a stripped field is absent from the wire, so
 * applying the remote record wholesale would erase the local one. Anything
 * withheld on the way up is restored from the local row on the way down.
 */
export function mergeFromSync(
  collection: SyncedCollection,
  incoming: Record<string, unknown>,
  local: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const stripped = STRIPPED_FIELDS[collection];
  if (!stripped || stripped.length === 0 || !local) return incoming;

  const merged = { ...incoming };
  for (const field of stripped) {
    if (field in local) merged[field] = local[field];
  }
  return merged;
}
