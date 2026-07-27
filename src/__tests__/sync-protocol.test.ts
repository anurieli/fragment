import { describe, it, expect } from "vitest";
import { parseSyncRequest, MAX_PUSH_CHANGES, isSyncedCollection } from "@/lib/sync/protocol";

/**
 * The sync endpoint takes writes from anyone holding a session cookie, so its
 * parser is a trust boundary rather than a convenience. These cover what it
 * must refuse, not just what it accepts.
 */

function change(over: Record<string, unknown> = {}) {
  return { collection: "notes", id: "n1", doc: { id: "n1" }, updatedAt: 100, deleted: false, ...over };
}

describe("parseSyncRequest", () => {
  it("accepts a well-formed request", () => {
    const result = parseSyncRequest({ cursor: 12, changes: [change()] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cursor).toBe(12);
      expect(result.value.changes).toHaveLength(1);
    }
  });

  it("accepts an empty push (a pull-only sync)", () => {
    const result = parseSyncRequest({ cursor: 0, changes: [] });
    expect(result.ok).toBe(true);
  });

  it("rejects a collection the client invented", () => {
    const result = parseSyncRequest({ cursor: 0, changes: [change({ collection: "secrets" })] });
    expect(result.ok).toBe(false);
  });

  it("rejects apiLogs, which must never travel as a document", () => {
    const result = parseSyncRequest({ cursor: 0, changes: [change({ collection: "apiLogs" })] });
    expect(result.ok).toBe(false);
  });

  it("rejects a negative or non-numeric cursor", () => {
    expect(parseSyncRequest({ cursor: -1, changes: [] }).ok).toBe(false);
    expect(parseSyncRequest({ cursor: "5", changes: [] }).ok).toBe(false);
  });

  it("rejects a missing id", () => {
    expect(parseSyncRequest({ cursor: 0, changes: [change({ id: "" })] }).ok).toBe(false);
  });

  it("rejects a non-deleted change with no body", () => {
    expect(parseSyncRequest({ cursor: 0, changes: [change({ doc: null })] }).ok).toBe(false);
  });

  it("drops the body of a tombstone rather than storing deleted content", () => {
    const result = parseSyncRequest({
      cursor: 0,
      changes: [change({ deleted: true, doc: { id: "n1", content: "private" } })],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.changes[0].doc).toBeNull();
  });

  it("rejects a push over the per-request limit", () => {
    const changes = Array.from({ length: MAX_PUSH_CHANGES + 1 }, (_, i) => change({ id: `n${i}` }));
    expect(parseSyncRequest({ cursor: 0, changes }).ok).toBe(false);
  });

  it("rejects a body that is not an object", () => {
    expect(parseSyncRequest(null).ok).toBe(false);
    expect(parseSyncRequest("nope").ok).toBe(false);
    expect(parseSyncRequest({ cursor: 0, changes: "nope" }).ok).toBe(false);
  });
});

describe("isSyncedCollection", () => {
  it("knows the writing collections", () => {
    expect(isSyncedCollection("notes")).toBe(true);
    expect(isSyncedCollection("ideas")).toBe(true);
    expect(isSyncedCollection("contentPieces")).toBe(true);
  });

  it("excludes telemetry and blobs", () => {
    expect(isSyncedCollection("apiLogs")).toBe(false);
    expect(isSyncedCollection("feedbackQueue")).toBe(false);
    expect(isSyncedCollection("images")).toBe(false);
    expect(isSyncedCollection("outbox")).toBe(false);
  });
});
