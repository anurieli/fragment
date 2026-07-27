import type { Transaction } from "dexie";
import { db } from "@/lib/db";
import type { OutboxEntry } from "@/lib/types";
import { SYNCED_COLLECTIONS, type SyncedCollection } from "./protocol";
import { tableFor } from "./collections";

/**
 * What has changed locally and still needs pushing.
 *
 * The entries are produced by Dexie table hooks rather than by calls sprinkled
 * through persistence.ts. That is the point: a hook cannot be forgotten. Every
 * existing writer is covered without editing it, and so is the next one
 * somebody adds a year from now, which is the failure this design is built to
 * prevent. A record that silently stops syncing is close to invisible until a
 * user loses work on their second device.
 */

/**
 * Marks a transaction as "these writes came from the server". Without it the
 * act of applying a pulled change would enqueue that same change for pushing,
 * and every sync would echo forever.
 *
 * It lives on the transaction rather than in a module-level boolean because a
 * global flag is wrong the moment a user edit lands while a pull is in
 * flight: the flag would suppress a real local change and lose it.
 */
const REMOTE_APPLY = Symbol.for("fragment.sync.remoteApply");

export function markTransactionAsRemoteApply(trans: Transaction | null): void {
  if (trans) (trans as unknown as Record<symbol, boolean>)[REMOTE_APPLY] = true;
}

function isRemoteApply(trans: Transaction | null | undefined): boolean {
  if (!trans) return false;
  return (trans as unknown as Record<symbol, boolean>)[REMOTE_APPLY] === true;
}

// Hooks fire inside the caller's transaction, whose scope does not include the
// outbox table, so writing there directly would throw. Entries are buffered
// and persisted on the next microtask instead.
let buffer: OutboxEntry[] = [];
let flushScheduled = false;
let onQueued: (() => void) | null = null;

/** Called after entries land in the outbox, to wake the sync engine. */
export function setOutboxListener(listener: (() => void) | null): void {
  onQueued = listener;
}

function scheduleBufferWrite(): void {
  if (flushScheduled) return;
  flushScheduled = true;

  queueMicrotask(() => {
    flushScheduled = false;
    const entries = buffer;
    buffer = [];
    if (entries.length === 0) return;

    // Last write for a given record wins within the batch; the compound
    // [collection+id] key then collapses it against anything already queued.
    const byKey = new Map<string, OutboxEntry>();
    for (const entry of entries) byKey.set(`${entry.collection}:${entry.id}`, entry);

    db.outbox
      .bulkPut([...byKey.values()])
      .then(() => onQueued?.())
      .catch(() => {
        // The record itself is already stored; a failed outbox write means it
        // syncs on its next edit rather than now. Never break the user's save.
      });
  });
}

function enqueue(collection: SyncedCollection, id: string, deleted: boolean): void {
  if (!id) return;
  buffer.push({ collection, id, updatedAt: Date.now(), deleted });
  scheduleBufferWrite();
}

let installed = false;

/**
 * Attach create/update/delete hooks to every synced table.
 *
 * Idempotent: Dexie keeps hooks across reopens, and dev-mode module reloads
 * would otherwise stack duplicates and enqueue each change several times.
 */
export function installOutboxHooks(): void {
  if (installed) return;
  installed = true;

  for (const collection of SYNCED_COLLECTIONS) {
    const table = tableFor(collection);

    table.hook("creating", (primKey, _obj, trans) => {
      if (isRemoteApply(trans)) return;
      enqueue(collection, String(primKey), false);
    });

    table.hook("updating", (_mods, primKey, _obj, trans) => {
      if (isRemoteApply(trans)) return;
      enqueue(collection, String(primKey), false);
    });

    table.hook("deleting", (primKey, _obj, trans) => {
      if (isRemoteApply(trans)) return;
      enqueue(collection, String(primKey), true);
    });
  }
}

/** Pending entries, oldest first. */
export async function pendingEntries(limit: number): Promise<OutboxEntry[]> {
  try {
    return await db.outbox.orderBy("updatedAt").limit(limit).toArray();
  } catch {
    return [];
  }
}

export async function pendingCount(): Promise<number> {
  try {
    return await db.outbox.count();
  } catch {
    return 0;
  }
}

/**
 * Drop entries that have been pushed, unless the record changed again while
 * the request was in flight.
 *
 * The comparison is what makes a slow network safe: an edit made during a push
 * bumps the entry's `updatedAt` past the value that was sent, and clearing it
 * blindly would drop that edit on the floor with nothing left to say it ever
 * happened.
 */
export async function clearPushed(entries: OutboxEntry[]): Promise<void> {
  if (entries.length === 0) return;

  try {
    await db.transaction("rw", db.outbox, async () => {
      for (const entry of entries) {
        const current = await db.outbox.get([entry.collection, entry.id]);
        if (current && current.updatedAt <= entry.updatedAt) {
          await db.outbox.delete([entry.collection, entry.id]);
        }
      }
    });
  } catch {
    // Leaving entries queued costs a redundant push next time, which is
    // harmless; dropping them would cost the change itself.
  }
}

/** Wipe the queue. Used when signing out, so one account cannot push another's edits. */
export async function clearOutbox(): Promise<void> {
  try {
    await db.outbox.clear();
  } catch {
    // best-effort
  }
}
