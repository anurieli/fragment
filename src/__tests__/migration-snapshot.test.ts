import { describe, it, expect, beforeEach } from "vitest";
import Dexie from "dexie";

import { db } from "@/lib/db";
import {
  captureSnapshot,
  closeMigrationBackupDb,
  ensurePreMigrationBackup,
  listSnapshots,
  readInstalledSchemaVersion,
  readSnapshot,
  restoreSnapshotIntoLibrary,
  storeSnapshot,
} from "@/lib/migration/snapshot";
import { dryRunFromSnapshot, formatDryRunReport } from "@/lib/migration/dry-run";

/**
 * These run against fake-indexeddb, which the shared test setup installs. That
 * means `db` here is a real Dexie instance that has walked the full v2 upgrade
 * chain, so a snapshot taken in this file exercises the same code path a
 * writer's browser will.
 */

async function seedLibrary() {
  await db.notes.bulkPut([
    {
      id: "n-standalone",
      title: "Standalone",
      content: "# Standalone\n\nText that must survive.",
      goal: "persuade",
      audience: "founders",
      tone: "dry",
      remember: "be brief",
      voiceId: null,
      createdAt: 10,
      updatedAt: 20,
    },
    {
      id: "n-linked",
      title: "Linked draft",
      content: "Draft body",
      goal: "",
      audience: "",
      tone: "",
      remember: "",
      createdAt: 11,
      updatedAt: 21,
    },
  ]);

  await db.ideas.put({
    id: "i1",
    title: "An idea",
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: 5,
    updatedAt: 5,
  });

  await db.contentPieces.bulkPut([
    {
      id: "p-draft",
      ideaId: "i1",
      format: "essay",
      status: "in-progress",
      origin: "user",
      noteId: "n-linked",
      seen: true,
      priority: 0,
      order: 0,
      createdAt: 12,
      updatedAt: 22,
    },
    {
      id: "p-short",
      ideaId: "i1",
      format: "linkedin",
      status: "inbox",
      origin: "user",
      body: "A short fragment",
      seen: false,
      priority: 0,
      order: 1,
      createdAt: 13,
      updatedAt: 23,
    },
  ]);

  await db.noteVersions.put({
    id: "v1",
    noteId: "n-standalone",
    title: "Standalone",
    content: "older text",
    goal: "",
    audience: "",
    tone: "",
    remember: "",
    name: "Quick save",
    trigger: "manual",
    wordCount: 2,
    createdAt: 15,
  });
}

async function clearLibrary() {
  await Promise.all([
    db.notes.clear(),
    db.ideas.clear(),
    db.contentPieces.clear(),
    db.noteVersions.clear(),
    db.snippets.clear(),
    db.reviews.clear(),
  ]);
}

describe("pre-migration snapshot", () => {
  beforeEach(async () => {
    await db.open();
    await clearLibrary();
    closeMigrationBackupDb();
    if (await Dexie.exists("fragment-migration-backup")) {
      await Dexie.delete("fragment-migration-backup");
    }
    await seedLibrary();
  });

  it("reads the installed schema version without declaring one", async () => {
    const version = await readInstalledSchemaVersion();
    expect(version).toBe(db.verno);
    expect(version).toBeGreaterThanOrEqual(19);
  });

  it("captures every table, including ones the app does not sync", async () => {
    const snapshot = await captureSnapshot();

    expect(snapshot).not.toBeNull();
    expect(snapshot?.tables.notes).toHaveLength(2);
    expect(snapshot?.tables.contentPieces).toHaveLength(2);
    expect(snapshot?.rowCounts.notes).toBe(2);
    // Dynamic mode adopts whatever is on disk, so local-only tables come too.
    expect(Object.keys(snapshot?.tables ?? {})).toContain("apiLogs");
    expect(Object.keys(snapshot?.tables ?? {})).toContain("outbox");
  });

  it("preserves note content byte for byte", async () => {
    const snapshot = await captureSnapshot();
    const captured = snapshot?.tables.notes.find((row) => row.id === "n-standalone");

    expect(captured?.content).toBe("# Standalone\n\nText that must survive.");
    expect(captured?.voiceId).toBeNull();
  });

  it("stores and reads back a snapshot from its own database", async () => {
    const snapshot = await captureSnapshot();
    if (!snapshot) throw new Error("expected a snapshot");

    const id = await storeSnapshot(snapshot);
    const listed = await listSnapshots();
    const roundTripped = await readSnapshot(id);

    expect(listed.map((row) => row.id)).toContain(id);
    expect(roundTripped?.tables.notes).toHaveLength(2);
  });

  it("does not capture when the library already has the target schema", async () => {
    const result = await ensurePreMigrationBackup(db.verno);
    expect(result).toBeNull();
  });

  it("captures once when the target schema is newer, and not again", async () => {
    const first = await ensurePreMigrationBackup(db.verno + 1);
    const second = await ensurePreMigrationBackup(db.verno + 1);

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(await listSnapshots()).toHaveLength(1);
  });

  it("restores rows that were deleted after the snapshot", async () => {
    const snapshot = await captureSnapshot();
    if (!snapshot) throw new Error("expected a snapshot");

    await db.notes.clear();
    expect(await db.notes.count()).toBe(0);

    const result = await restoreSnapshotIntoLibrary(snapshot);

    expect(result.restored.notes).toBe(2);
    expect(result.skipped).toEqual([]);
    const recovered = await db.notes.get("n-standalone");
    expect(recovered?.content).toBe("# Standalone\n\nText that must survive.");
  });

  it("skips snapshot tables the library no longer has instead of failing", async () => {
    const snapshot = await captureSnapshot();
    if (!snapshot) throw new Error("expected a snapshot");
    snapshot.tables.retiredTable = [{ id: "x" }];

    const result = await restoreSnapshotIntoLibrary(snapshot);

    expect(result.skipped).toEqual(["retiredTable"]);
    expect(result.restored.notes).toBe(2);
  });
});

describe("dry run", () => {
  beforeEach(async () => {
    await db.open();
    await clearLibrary();
    await seedLibrary();
  });

  it("plans the real library without writing anything", async () => {
    const before = {
      notes: await db.notes.count(),
      ideas: await db.ideas.count(),
      pieces: await db.contentPieces.count(),
    };

    const snapshot = await captureSnapshot();
    if (!snapshot) throw new Error("expected a snapshot");
    const report = dryRunFromSnapshot(snapshot);

    expect(report.plan.counts.notes).toBe(2);
    expect(report.plan.counts.promotions).toBe(1);
    expect(report.plan.counts.absorptions).toBe(1);
    expect(report.plan.noteToPiece["n-standalone"]).toBe("migp-n-standalone");
    expect(report.plan.noteToPiece["n-linked"]).toBe("p-draft");
    expect(report.plan.rekeys.noteVersions).toHaveLength(1);
    expect(report.unreadable).toEqual({});

    expect(await db.notes.count()).toBe(before.notes);
    expect(await db.ideas.count()).toBe(before.ideas);
    expect(await db.contentPieces.count()).toBe(before.pieces);
  });

  it("counts rows it could not read rather than dropping them quietly", async () => {
    const snapshot = await captureSnapshot();
    if (!snapshot) throw new Error("expected a snapshot");
    snapshot.tables.notes.push({ id: "broken" });

    const report = dryRunFromSnapshot(snapshot);

    expect(report.unreadable.notes).toBe(1);
    expect(report.plan.counts.notes).toBe(2);
  });

  it("formats a report a person can read", async () => {
    const snapshot = await captureSnapshot();
    if (!snapshot) throw new Error("expected a snapshot");

    const text = formatDryRunReport(dryRunFromSnapshot(snapshot));

    expect(text).toContain("Notes examined");
    expect(text).toContain("becoming new ideas");
  });
});
