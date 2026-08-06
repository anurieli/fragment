/**
 * The wire contract between a Fragment client and its cloud.
 *
 * Shared by both sides on purpose: the client builds these objects and the
 * server validates them against the same definitions, so a change to the
 * protocol cannot land on one side only.
 *
 * The model is delta sync over a monotonic cursor. Every stored record carries
 * a server-assigned `rev` from one sequence; a client remembers the highest
 * `rev` it has applied and asks for everything above it. That gives resumable
 * sync with no timestamps in the pull path and no full-table scans.
 *
 * Timestamps do appear, in `updatedAt`, but for the unrelated job of deciding
 * which of two concurrent edits wins. Fragment resolves that last-write-wins
 * per record: the higher `updatedAt` survives whole. That is the honest
 * trade for a writing app. Two devices editing the same note at once is rare,
 * and a merge that interleaved characters from both would corrupt prose in
 * ways a writer cannot undo, whereas losing the older of two versions is
 * recoverable from note history.
 */

/** Collections that participate in sync. */
export const SYNCED_COLLECTIONS = [
  "notes",
  "snippets",
  "noteVersions",
  "ideas",
  "contentPieces",
  "resources",
  "reviews",
  "comments",
  "voices",
  "voiceSamples",
  "settings",
] as const;

export type SyncedCollection = (typeof SYNCED_COLLECTIONS)[number];

const COLLECTION_SET = new Set<string>(SYNCED_COLLECTIONS);

export function isSyncedCollection(value: unknown): value is SyncedCollection {
  return typeof value === "string" && COLLECTION_SET.has(value);
}

/**
 * Deliberately absent from the list above:
 *
 *   apiLogs, feedbackQueue — telemetry, not the user's writing. They have
 *     their own one-way endpoints and should never come back down to a client.
 *   images — binary blobs. They belong in object storage with the document
 *     holding a key, not inlined as base64 in every delta.
 */

/** One record's state, as it travels in either direction. */
export interface SyncChange {
  collection: SyncedCollection;
  id: string;
  /** The record body. Null when `deleted` — a tombstone carries no content. */
  doc: Record<string, unknown> | null;
  /** Client wall clock, ms. Drives last-write-wins. */
  updatedAt: number;
  deleted: boolean;
}

export interface SyncRequest {
  /** Highest rev this client has applied. 0 on a first, full sync. */
  cursor: number;
  changes: SyncChange[];
}

export interface SyncResponse {
  cursor: number;
  changes: SyncChange[];
  /** True when more remains above `cursor`; call again to continue. */
  hasMore: boolean;
}

/** Most changes a client may push in one request. */
export const MAX_PUSH_CHANGES = 500;

/** Most changes the server returns in one response. */
export const MAX_PULL_CHANGES = 500;

export interface ParsedSyncRequest {
  cursor: number;
  changes: SyncChange[];
}

/**
 * Validate an untrusted request body.
 *
 * Returns an error string rather than throwing, so the route can answer 400
 * with something specific. Unknown collections are rejected outright: without
 * that check a caller could write unbounded junk into the documents table
 * under names the client will never read back.
 */
export function parseSyncRequest(body: unknown): { ok: true; value: ParsedSyncRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Expected an object body" };
  }

  const raw = body as Record<string, unknown>;

  const cursor = raw.cursor;
  if (typeof cursor !== "number" || !Number.isFinite(cursor) || cursor < 0) {
    return { ok: false, error: "cursor must be a non-negative number" };
  }

  if (!Array.isArray(raw.changes)) {
    return { ok: false, error: "changes must be an array" };
  }

  if (raw.changes.length > MAX_PUSH_CHANGES) {
    return { ok: false, error: `changes exceeds the ${MAX_PUSH_CHANGES} per-request limit` };
  }

  const changes: SyncChange[] = [];
  for (let i = 0; i < raw.changes.length; i++) {
    const parsed = parseChange(raw.changes[i], i);
    if (!parsed.ok) return parsed;
    changes.push(parsed.value);
  }

  return { ok: true, value: { cursor, changes } };
}

function parseChange(
  input: unknown,
  index: number,
): { ok: true; value: SyncChange } | { ok: false; error: string } {
  if (!input || typeof input !== "object") {
    return { ok: false, error: `changes[${index}] is not an object` };
  }

  const raw = input as Record<string, unknown>;

  if (!isSyncedCollection(raw.collection)) {
    return { ok: false, error: `changes[${index}].collection is not a synced collection` };
  }

  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 200) {
    return { ok: false, error: `changes[${index}].id must be a non-empty string` };
  }

  if (typeof raw.updatedAt !== "number" || !Number.isFinite(raw.updatedAt)) {
    return { ok: false, error: `changes[${index}].updatedAt must be a number` };
  }

  const deleted = raw.deleted === true;

  // A tombstone's body is always dropped: keeping it would leave deleted
  // content readable on the server after the user removed it.
  const doc = deleted
    ? null
    : raw.doc && typeof raw.doc === "object" && !Array.isArray(raw.doc)
      ? (raw.doc as Record<string, unknown>)
      : null;

  if (!deleted && doc === null) {
    return { ok: false, error: `changes[${index}].doc must be an object unless deleted` };
  }

  return {
    ok: true,
    value: { collection: raw.collection, id: raw.id, doc, updatedAt: raw.updatedAt, deleted },
  };
}
