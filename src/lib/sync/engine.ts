import Dexie from "dexie";
import { db } from "@/lib/db";
import type { OutboxEntry, SyncStateRow } from "@/lib/types";
import {
  MAX_PUSH_CHANGES,
  SYNCED_COLLECTIONS,
  type SyncChange,
  type SyncedCollection,
} from "./protocol";
import { mergeFromSync, sanitizeForSync, tableFor } from "./collections";
import {
  clearOutbox,
  installOutboxHooks,
  markTransactionAsRemoteApply,
  pendingCount,
  pendingEntries,
  clearPushed,
  setOutboxListener,
} from "./outbox";
import {
  CloudUnavailable,
  NotSignedIn,
  fetchCurrentUser,
  isCloudReachable,
  postSync,
} from "./api";
import { removeNoteBackupArtifacts } from "@/lib/persistence";

/**
 * The client half of sync: drain the outbox, apply what comes back, repeat.
 *
 * Everything here is additive. Fragment is local-first and stays fully usable
 * with no account, no network and no server, so every path in this file has to
 * fail into "carry on locally" rather than into an error the writer has to
 * think about. Sync is a background convenience, never a precondition for
 * saving a word.
 */

export type SyncStatus =
  | "disabled"
  | "signed-out"
  | "idle"
  | "syncing"
  | "offline"
  | "account-mismatch"
  | "error";

export interface SyncSnapshot {
  status: SyncStatus;
  lastSyncedAt: number | null;
  pending: number;
  error: string | null;
  /** Bumped whenever remote changes land, so the UI knows to reload. */
  dataRevision: number;
}

const SYNC_STATE_ID = "main";
const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 1_500;

let snapshot: SyncSnapshot = {
  status: "signed-out",
  lastSyncedAt: null,
  pending: 0,
  error: null,
  dataRevision: 0,
};

const listeners = new Set<(s: SyncSnapshot) => void>();

export function getSyncSnapshot(): SyncSnapshot {
  return snapshot;
}

export function subscribeToSync(listener: (s: SyncSnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function update(patch: Partial<SyncSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const listener of listeners) listener(snapshot);
}

// ---------------------------------------------------------------------------
// Local sync state
// ---------------------------------------------------------------------------

const DEFAULT_STATE: SyncStateRow = {
  id: SYNC_STATE_ID,
  cursor: 0,
  lastSyncedAt: null,
  userId: null,
};

async function loadState(): Promise<SyncStateRow> {
  try {
    return (await db.syncState.get(SYNC_STATE_ID)) ?? DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}

async function saveState(state: SyncStateRow): Promise<void> {
  try {
    await db.syncState.put(state);
  } catch {
    // A lost cursor costs one redundant full pull, not correctness: applying a
    // change already held is a no-op.
  }
}

/**
 * Forget this device's link to an account without touching the writing.
 *
 * The escape hatch for the account-mismatch stop: the person is told whose
 * data is on the device and chooses. Nothing is deleted here.
 */
export async function resetSyncLink(): Promise<void> {
  await clearOutbox();
  await saveState({ ...DEFAULT_STATE });
  update({ status: "signed-out", error: null, pending: 0, lastSyncedAt: null });
}

/**
 * Queue every local record for upload.
 *
 * Runs once, when a device is first linked to an account, so that writing that
 * predates sign-in becomes the starting content of the account rather than
 * being stranded in the browser it was written in.
 */
async function seedOutboxFromLocal(): Promise<void> {
  const now = Date.now();
  const entries: OutboxEntry[] = [];

  for (const collection of SYNCED_COLLECTIONS) {
    try {
      const ids = await tableFor(collection).toCollection().primaryKeys();
      for (const id of ids) {
        entries.push({ collection, id: String(id), updatedAt: now, deleted: false });
      }
    } catch {
      // A table that will not open cannot be seeded; the rest still can.
    }
  }

  if (entries.length === 0) return;

  try {
    await db.outbox.bulkPut(entries);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Push / apply
// ---------------------------------------------------------------------------

/** Turn queued entries into wire changes, reading each record's current body. */
async function buildChanges(entries: OutboxEntry[]): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];

  for (const entry of entries) {
    const collection = entry.collection as SyncedCollection;
    if (!(SYNCED_COLLECTIONS as readonly string[]).includes(collection)) continue;

    if (entry.deleted) {
      changes.push({ collection, id: entry.id, doc: null, updatedAt: entry.updatedAt, deleted: true });
      continue;
    }

    let row: Record<string, unknown> | undefined;
    try {
      row = await tableFor(collection).get(entry.id);
    } catch {
      continue;
    }

    // Queued as an edit but gone by the time we look: it was deleted in
    // between, so the truthful thing to send is the deletion.
    if (!row) {
      changes.push({ collection, id: entry.id, doc: null, updatedAt: entry.updatedAt, deleted: true });
      continue;
    }

    changes.push({
      collection,
      id: entry.id,
      doc: sanitizeForSync(collection, row),
      updatedAt: entry.updatedAt,
      deleted: false,
    });
  }

  return changes;
}

/**
 * Write pulled changes into Dexie.
 *
 * The transaction is tagged so the outbox hooks ignore these writes; without
 * that, applying a change would queue it straight back for pushing.
 */
async function applyRemote(changes: SyncChange[]): Promise<number> {
  if (changes.length === 0) return 0;

  // Guard against a collection this build has no table for. The account is
  // shared with whatever other versions of Fragment the writer is running, and
  // the wire carries no version field, so a newer device can push a collection
  // an older one has never heard of. Reaching for db[unknown] throws, and
  // because that happens inside the apply transaction it takes down the whole
  // sync loop, stranding a client that is otherwise working fine.
  //
  // Skipping degrades instead of breaking, but it is not free: the cursor
  // still advances past the skipped rev, so this client will not see those
  // records again until something touches them. That is the right trade for
  // the case it exists for, a stale tab on older code, which stops mattering
  // the moment the tab reloads. It would be the wrong trade for a collection
  // that a supported build is expected to be missing, and there is no such
  // collection today.
  const tables = SYNCED_COLLECTIONS.map((c) => tableFor(c)).filter(Boolean);
  let applied = 0;
  const deletedNoteIds: string[] = [];

  await db.transaction("rw", [...tables, db.outbox], async () => {
    markTransactionAsRemoteApply(Dexie.currentTransaction);

    for (const change of changes) {
      const collection = change.collection;
      const table = tableFor(collection);
      if (!table) continue;

      // A local edit still waiting to be pushed and newer than what arrived
      // wins: it is about to be sent, and overwriting it here would destroy a
      // change the user made and never see it again.
      const pending = await db.outbox.get([collection, change.id]);
      if (pending && pending.updatedAt > change.updatedAt) continue;

      if (change.deleted) {
        await table.delete(change.id);
        if (collection === "notes") deletedNoteIds.push(change.id);
        applied++;
        continue;
      }

      if (!change.doc) continue;

      const local = await table.get(change.id);
      const merged = mergeFromSync(collection, change.doc, local) as Record<string, unknown> & {
        id: string;
      };
      await table.put({ ...merged, id: change.id });
      applied++;
    }
  });

  await Promise.all(deletedNoteIds.map((id) => removeNoteBackupArtifacts(id)));

  return applied;
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

let running = false;
let rerunRequested = false;

export async function syncNow(): Promise<void> {
  if (!isCloudReachable()) {
    update({ status: "disabled" });
    return;
  }

  // One sync at a time. A second caller sets a flag so its changes are not
  // simply dropped: the in-flight run repeats when it finishes.
  if (running) {
    rerunRequested = true;
    return;
  }
  running = true;

  try {
    const user = await fetchCurrentUser();
    if (!user) {
      update({ status: "signed-out", pending: await pendingCount() });
      return;
    }

    let state = await loadState();

    if (state.userId && state.userId !== user.id) {
      update({
        status: "account-mismatch",
        error: "This device holds another account's writing. Sign out, or reset the link, to sync.",
      });
      return;
    }

    if (!state.userId) {
      // First link on this device: adopt the account and offer up everything
      // written before sign-in.
      await seedOutboxFromLocal();
      state = { ...state, userId: user.id };
      await saveState(state);
    }

    update({ status: "syncing", error: null });

    let guard = 0;
    let keepGoing = true;

    while (keepGoing && guard++ < 100) {
      const entries = await pendingEntries(MAX_PUSH_CHANGES);
      const changes = await buildChanges(entries);

      const response = await postSync({ cursor: state.cursor, changes });

      const applied = await applyRemote(response.changes);
      await clearPushed(entries);

      state = { ...state, cursor: response.cursor, lastSyncedAt: Date.now() };
      await saveState(state);

      if (applied > 0) {
        update({ dataRevision: snapshot.dataRevision + 1 });
      }

      const stillPending = await pendingCount();
      keepGoing = response.hasMore || stillPending > 0;

      // Nothing pushed and nothing pulled means there is no progress left to
      // make; without this a permanently rejected entry would spin forever.
      if (changes.length === 0 && response.changes.length === 0) keepGoing = false;
    }

    update({
      status: "idle",
      lastSyncedAt: state.lastSyncedAt,
      pending: await pendingCount(),
      error: null,
    });
  } catch (err) {
    if (err instanceof NotSignedIn) {
      update({ status: "signed-out", pending: await pendingCount() });
    } else if (err instanceof CloudUnavailable) {
      update({ status: "disabled" });
    } else if (typeof navigator !== "undefined" && !navigator.onLine) {
      update({ status: "offline", pending: await pendingCount() });
    } else {
      update({
        status: "error",
        error: err instanceof Error ? err.message : "Sync failed",
        pending: await pendingCount(),
      });
    }
  } finally {
    running = false;
    if (rerunRequested) {
      rerunRequested = false;
      void syncNow();
    }
  }
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Ask for a sync soon, coalescing bursts of edits into one round trip. */
export function requestSync(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void syncNow();
  }, DEBOUNCE_MS);
}

let started = false;

/**
 * Install hooks and start syncing. Returns a stop function.
 *
 * Safe to call when signed out or offline: it wires listeners and does
 * nothing else until there is a session to sync with.
 */
export function startSyncEngine(): () => void {
  if (started) return () => {};
  started = true;

  installOutboxHooks();
  setOutboxListener(requestSync);

  const interval = setInterval(() => void syncNow(), POLL_INTERVAL_MS);

  const onOnline = () => void syncNow();
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncNow();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);

  void syncNow();

  return () => {
    started = false;
    clearInterval(interval);
    setOutboxListener(null);
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisible);
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}
