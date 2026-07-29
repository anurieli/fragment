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
 * Fields stripped on the way out, per collection. Dots denote nesting.
 *
 * `providerCredentials` holds the user's own OpenAI, Anthropic and OpenRouter
 * keys. Fragment's whole pitch is bring-your-own-key, and a key the user
 * pasted into their own machine has no business being copied into our
 * database: it would turn a writing sync feature into a credential store,
 * with the breach surface that implies. The rest of settings — writing style,
 * profile, feature preferences — is exactly the kind of thing you want to
 * find already configured on a second device.
 *
 * The same reasoning covers three credentials that live under `userProfile`
 * rather than beside the provider keys, and were therefore missed when this
 * list was first written: `kitApiKey` is full control of the writer's mailing
 * list, and `composioApiKey` plus `linkedInConnectedAccountId` together are
 * permission to post to their LinkedIn as them. A field is on this list
 * because of what it can do, not because of where it happens to sit in the
 * settings object.
 */
const STRIPPED_FIELDS: Partial<Record<SyncedCollection, string[]>> = {
  settings: [
    "providerCredentials",
    "userProfile.kitApiKey",
    "userProfile.composioApiKey",
    "userProfile.linkedInConnectedAccountId",
  ],
};

/** Read a dotted path, returning `undefined` if any link is missing. */
function readPath(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node === null || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[key];
  }, row);
}

/** True when the whole path exists, so a restore knows to put it back. */
function hasPath(row: Record<string, unknown>, path: string): boolean {
  const keys = path.split(".");
  let node: unknown = row;
  for (const key of keys) {
    if (node === null || typeof node !== "object") return false;
    if (!(key in (node as Record<string, unknown>))) return false;
    node = (node as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * Copy-on-write down a dotted path. Every object along the way is cloned, so
 * the caller's row (which is the live Dexie record) is never mutated.
 */
function withPath(
  row: Record<string, unknown>,
  path: string,
  apply: (parent: Record<string, unknown>, key: string) => void,
): Record<string, unknown> {
  const keys = path.split(".");
  const copy = { ...row };

  let parent: Record<string, unknown> = copy;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const child = parent[key];
    if (child === null || typeof child !== "object") return copy;
    const cloned = { ...(child as Record<string, unknown>) };
    parent[key] = cloned;
    parent = cloned;
  }

  apply(parent, keys[keys.length - 1]);
  return copy;
}

/** The version of a record that is safe to send. */
export function sanitizeForSync(
  collection: SyncedCollection,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const stripped = STRIPPED_FIELDS[collection];
  if (!stripped || stripped.length === 0) return row;

  let copy = row;
  for (const field of stripped) {
    copy = withPath(copy, field, (parent, key) => {
      delete parent[key];
    });
  }
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

  let merged = incoming;
  for (const field of stripped) {
    if (!hasPath(local, field)) continue;
    const value = readPath(local, field);
    merged = withPath(merged, field, (parent, key) => {
      parent[key] = value;
    });
  }
  return merged;
}
