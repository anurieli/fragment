import { describe, it, expect, beforeEach } from "vitest";
import Dexie from "dexie";

import { db } from "@/lib/db";
import { closeMigrationBackupDb } from "@/lib/migration/snapshot";
import {
  ONE_ENTITY_MIGRATION_ID,
  isOneEntityMigrationComplete,
  readMigrationRecord,
  runOneEntityMigration,
} from "@/lib/migration/run";

/**
 * The migration end to end, against a real Dexie database on fake-indexeddb.
 *
 * The promise these tests exist to hold is narrow and absolute: after the
 * migration, every note's text is readable somewhere, and if it is not, the
 * migration left the library alone instead of keeping a broken result.
 */

const STANDALONE_BODY = "# Standalone\n\nLine one.\n\nLine two, with trailing space.  \n";
const DRAFT_BODY = "The draft that already lived in an idea.";

async function reset() {
  await db.open();
  await Promise.all([
    db.notes.clear(),
    db.noteVersions.clear(),
    db.pieceVersions.clear(),
    db.ideas.clear(),
    db.contentPieces.clear(),
    db.reviews.clear(),
    db.snippets.clear(),
    db.migrations.clear(),
  ]);
  closeMigrationBackupDb();
  if (await Dexie.exists("fragment-migration-backup")) await Dexie.delete("fragment-migration-backup");
}

async function seed() {
  await db.notes.bulkPut([
    {
      id: "n-standalone",
      title: "Standalone",
      subtitle: "a dek",
      content: STANDALONE_BODY,
      goal: "persuade",
      audience: "founders",
      tone: "dry",
      remember: "be brief",
      voiceId: null,
      createdAt: 100,
      updatedAt: 200,
    },
    {
      id: "n-draft",
      title: "Linked draft",
      content: DRAFT_BODY,
      goal: "",
      audience: "",
      tone: "",
      remember: "",
      createdAt: 110,
      updatedAt: 210,
    },
    {
      id: "n-untitled",
      title: "",
      content: "First line becomes the title\n\nand the rest follows.",
      goal: "",
      audience: "",
      tone: "",
      remember: "",
      createdAt: 120,
      updatedAt: 220,
    },
    {
      id: "n-empty",
      title: "",
      content: "",
      goal: "",
      audience: "",
      tone: "",
      remember: "",
      createdAt: 130,
      updatedAt: 230,
    },
  ]);

  await db.ideas.put({
    id: "i1",
    title: "An existing idea",
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: 50,
    updatedAt: 50,
  });

  await db.contentPieces.bulkPut([
    {
      id: "p-draft",
      ideaId: "i1",
      format: "essay",
      status: "in-progress",
      origin: "user",
      noteId: "n-draft",
      seen: true,
      priority: 0,
      order: 0,
      createdAt: 111,
      updatedAt: 211,
    },
    {
      id: "p-short",
      ideaId: "i1",
      format: "linkedin",
      status: "inbox",
      origin: "agent",
      body: "A short fragment that was already a fragment.",
      seen: false,
      priority: 0,
      order: 1,
      createdAt: 112,
      updatedAt: 212,
    },
  ]);

  await db.noteVersions.put({
    id: "v1",
    noteId: "n-standalone",
    title: "Standalone",
    content: "an older draft of it",
    goal: "persuade",
    audience: "founders",
    tone: "dry",
    remember: "be brief",
    voiceId: null,
    name: "Quick save",
    trigger: "manual",
    wordCount: 5,
    createdAt: 150,
  });

  await db.snippets.put({
    id: "s1",
    noteId: "n-standalone",
    content: "a cut line",
    label: null,
    labelStatus: "idle",
    createdAt: 160,
    order: 0,
  });

  await db.reviews.put({
    id: "r1",
    noteId: "n-draft",
    docId: "n-draft",
    reviewerName: "someone",
    timestamp: 165,
    comments: [],
    receivedAt: 170,
  });
}

describe("runOneEntityMigration", () => {
  beforeEach(async () => {
    await reset();
    await seed();
  });

  it("gives every note a fragment holding its exact text", async () => {
    const outcome = await runOneEntityMigration();
    expect(outcome.status).toBe("complete");

    const notes = await db.notes.toArray();
    const pieces = await db.contentPieces.toArray();

    for (const note of notes) {
      const holder = pieces.find((piece) => piece.legacyNoteId === note.id);
      expect(holder, `no fragment holds note ${note.id}`).toBeTruthy();
      expect(holder?.body).toBe(note.content);
    }
  });

  it("preserves whitespace and trailing characters exactly", async () => {
    await runOneEntityMigration();

    const holder = await db.contentPieces.get("migp-n-standalone");
    expect(holder?.body).toBe(STANDALONE_BODY);
  });

  it("never deletes a note, a version, a snip or a review", async () => {
    await runOneEntityMigration();

    expect(await db.notes.count()).toBe(4);
    expect(await db.noteVersions.count()).toBe(1);
    expect(await db.snippets.count()).toBe(1);
    expect(await db.reviews.count()).toBe(1);
    expect((await db.noteVersions.get("v1"))?.content).toBe("an older draft of it");
  });

  it("promotes a standalone note into its own idea under deterministic ids", async () => {
    await runOneEntityMigration();

    const idea = await db.ideas.get("mig-n-standalone");
    const piece = await db.contentPieces.get("migp-n-standalone");

    expect(idea?.title).toBe("Standalone");
    expect(piece?.ideaId).toBe("mig-n-standalone");
    expect(piece?.format).toBe("essay");
    expect(piece?.subtitle).toBe("a dek");
    expect(piece?.goal).toBe("persuade");
    expect(piece?.audience).toBe("founders");
    expect(piece?.tone).toBe("dry");
    expect(piece?.remember).toBe("be brief");
    expect(piece?.voiceId).toBeNull();
  });

  it("folds a linked draft into the fragment that already pointed at it", async () => {
    await runOneEntityMigration();

    const piece = await db.contentPieces.get("p-draft");
    expect(piece?.body).toBe(DRAFT_BODY);
    expect(piece?.legacyNoteId).toBe("n-draft");
    expect(piece?.noteId).toBeUndefined();
    expect(piece?.ideaId).toBe("i1");
    expect(piece?.title).toBe("Linked draft");
    // No second idea was invented for a note that already had a home.
    expect(await db.ideas.get("mig-n-draft")).toBeUndefined();
  });

  it("titles an untitled note from its first line", async () => {
    await runOneEntityMigration();

    const idea = await db.ideas.get("mig-n-untitled");
    expect(idea?.title).toBe("First line becomes the title");
  });

  it("carries an empty note across rather than dropping it", async () => {
    await runOneEntityMigration();

    const piece = await db.contentPieces.get("migp-n-empty");
    expect(piece).toBeTruthy();
    expect(piece?.body).toBe("");
  });

  it("leaves fragments that were never notes untouched", async () => {
    await runOneEntityMigration();

    const piece = await db.contentPieces.get("p-short");
    expect(piece?.body).toBe("A short fragment that was already a fragment.");
    expect(piece?.legacyNoteId).toBeUndefined();
    expect(piece?.origin).toBe("agent");
  });

  it("carries versions into pieceVersions and re-keys snips and reviews", async () => {
    await runOneEntityMigration();

    const version = await db.pieceVersions.get("v1");
    expect(version?.pieceId).toBe("migp-n-standalone");
    expect(version?.legacyNoteId).toBe("n-standalone");
    expect(version?.content).toBe("an older draft of it");

    expect((await db.snippets.get("s1"))?.pieceId).toBe("migp-n-standalone");
    expect((await db.reviews.get("r1"))?.pieceId).toBe("p-draft");
  });

  it("records what it did, and reports itself complete", async () => {
    const outcome = await runOneEntityMigration();

    const record = await readMigrationRecord();
    expect(record?.id).toBe(ONE_ENTITY_MIGRATION_ID);
    expect(record?.status).toBe("complete");
    expect(record?.counts?.notes).toBe(4);
    expect(record?.counts?.promotions).toBe(3);
    expect(record?.counts?.absorptions).toBe(1);
    expect(record?.snapshotId).toBeTruthy();
    expect(await isOneEntityMigrationComplete()).toBe(true);
    expect(outcome.plan?.counts.notes).toBe(4);
  });

  it("is idempotent: a second run changes nothing", async () => {
    await runOneEntityMigration();
    const after = await db.contentPieces.toArray();

    const second = await runOneEntityMigration();

    expect(second.status).toBe("skipped");
    expect(await db.contentPieces.toArray()).toEqual(after);
  });

  it("converges when forced to run twice, as two devices would", async () => {
    await runOneEntityMigration();
    const first = await db.contentPieces.orderBy("id").toArray();
    const firstIdeas = await db.ideas.orderBy("id").toArray();

    await runOneEntityMigration({ force: true });

    expect(await db.contentPieces.orderBy("id").toArray()).toEqual(first);
    expect(await db.ideas.orderBy("id").toArray()).toEqual(firstIdeas);
  });

  it("takes a pre-migration snapshot before writing anything", async () => {
    await runOneEntityMigration();

    closeMigrationBackupDb();
    const backup = new Dexie("fragment-migration-backup");
    await backup.open();
    const rows = (await backup.table("snapshots").toArray()) as { tables: Record<string, unknown[]> }[];
    backup.close();

    expect(rows).toHaveLength(1);
    // The snapshot holds the library as it was: notes present, no migrated ids.
    expect(rows[0].tables.notes).toHaveLength(4);
    const snapshotPieces = rows[0].tables.contentPieces as { id: string }[];
    expect(snapshotPieces.map((piece) => piece.id)).toEqual(["p-draft", "p-short"]);
  });
});

describe("runOneEntityMigration when verification refuses", () => {
  beforeEach(async () => {
    await reset();
    await seed();
  });

  it("rolls back every write and leaves the library as it was", async () => {
    // A note whose id collides with the fragment id its own promotion would
    // use. The promotion overwrites the other note's fragment, so one note
    // ends up without a home and the gate has to catch it.
    await db.contentPieces.put({
      id: "migp-n-standalone",
      ideaId: "i1",
      format: "linkedin",
      status: "inbox",
      origin: "user",
      body: "an unrelated fragment squatting on the migration id",
      seen: true,
      priority: 0,
      order: 9,
      createdAt: 1,
      updatedAt: 1,
      deletedAt: undefined,
    });
    // Point it at a note as well, so the planner treats it as the absorber for
    // n-untitled and the promotion for n-standalone then overwrites the body.
    await db.contentPieces.update("migp-n-standalone", { noteId: "n-untitled" });

    const before = await db.contentPieces.orderBy("id").toArray();
    const ideasBefore = await db.ideas.count();

    const outcome = await runOneEntityMigration();

    expect(outcome.status).toBe("failed");
    expect(outcome.verification?.ok).toBe(false);
    expect(await db.contentPieces.orderBy("id").toArray()).toEqual(before);
    expect(await db.ideas.count()).toBe(ideasBefore);
    expect(await db.pieceVersions.count()).toBe(0);

    const record = await readMigrationRecord();
    expect(record?.status).toBe("failed");
    expect(record?.failures?.length).toBeGreaterThan(0);
    expect(await isOneEntityMigrationComplete()).toBe(false);
  });

  it("keeps every note readable after a refused migration", async () => {
    await db.contentPieces.put({
      id: "migp-n-standalone",
      ideaId: "i1",
      format: "linkedin",
      status: "inbox",
      origin: "user",
      noteId: "n-untitled",
      seen: true,
      priority: 0,
      order: 9,
      createdAt: 1,
      updatedAt: 1,
    });

    await runOneEntityMigration();

    const notes = await db.notes.toArray();
    expect(notes).toHaveLength(4);
    expect(notes.find((note) => note.id === "n-standalone")?.content).toBe(STANDALONE_BODY);
  });
});
