import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  createLibraryBackup,
  parseLibraryBackup,
  restoreLibraryBackup,
} from "@/lib/library-backup";
import { tableFor } from "@/lib/sync/collections";
import {
  SYNCED_COLLECTIONS,
  type SyncedCollection,
} from "@/lib/sync/protocol";

const CREATED_AT = 1_786_000_000_000;
const UPDATED_AT = CREATED_AT + 60_000;
const DELETED_AT = UPDATED_AT + 60_000;

type BackupRow = Record<string, unknown> & { id: string };

const library: Record<SyncedCollection, BackupRow[]> = {
  notes: [
    {
      id: "note-draft",
      title: "A linked draft",
      content: "The long-form half of the library.",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    },
  ],
  snippets: [
    {
      id: "snippet-linked",
      noteId: "note-draft",
      ideaId: "idea-child",
      content: "A reusable fragment",
      order: 2,
      createdAt: CREATED_AT + 1,
      updatedAt: UPDATED_AT + 1,
    },
  ],
  noteVersions: [
    {
      id: "version-draft-1",
      noteId: "note-draft",
      content: "The first version.",
      createdAt: CREATED_AT + 2,
      updatedAt: UPDATED_AT + 2,
    },
  ],
  ideas: [
    {
      id: "idea-root",
      title: "Root idea",
      parentId: null,
      priority: 1,
      origin: "user",
      createdAt: CREATED_AT + 3,
      updatedAt: UPDATED_AT + 3,
    },
    {
      id: "idea-child",
      title: "Deleted child idea",
      parentId: "idea-root",
      priority: 3,
      origin: "agent",
      createdAt: CREATED_AT + 4,
      updatedAt: UPDATED_AT + 4,
      deletedAt: DELETED_AT + 4,
    },
  ],
  contentPieces: [
    {
      id: "piece-published",
      ideaId: "idea-root",
      noteId: "note-draft",
      format: "substack",
      status: "published",
      origin: "user",
      seen: true,
      priority: 1,
      order: 0,
      publish: {
        platform: "substack",
        method: "manual",
        publishedAt: UPDATED_AT + 5,
        url: "https://example.com/published",
        verified: true,
      },
      createdAt: CREATED_AT + 5,
      updatedAt: UPDATED_AT + 5,
    },
    {
      id: "piece-tombstone",
      ideaId: "idea-child",
      body: "A removed short-form draft.",
      format: "linkedin",
      status: "ready",
      origin: "agent",
      seen: false,
      priority: 2,
      order: 1,
      agentMeta: {
        agent: "maya",
        model: "test-model",
        pushedAt: CREATED_AT + 6,
      },
      createdAt: CREATED_AT + 6,
      updatedAt: UPDATED_AT + 6,
      deletedAt: DELETED_AT + 6,
    },
  ],
  resources: [
    {
      id: "resource-idea",
      ownerType: "idea",
      ownerId: "idea-root",
      kind: "link",
      title: "Idea source",
      url: "https://example.com/source",
      createdAt: CREATED_AT + 7,
    },
    {
      id: "resource-piece",
      ownerType: "piece",
      ownerId: "piece-published",
      kind: "note",
      title: "Piece context",
      note: "Keep this relationship intact.",
      createdAt: CREATED_AT + 8,
    },
  ],
  reviews: [
    {
      id: "review-draft",
      noteId: "note-draft",
      receivedAt: UPDATED_AT + 9,
      reviewer: "editor@example.com",
      comments: [],
      updatedAt: UPDATED_AT + 9,
    },
  ],
  comments: [
    {
      id: "comment-draft",
      noteId: "note-draft",
      ideaId: null,
      body: "A note comment promoted into an idea.",
      promotedIdeaId: "idea-child",
      createdAt: CREATED_AT + 10,
      updatedAt: UPDATED_AT + 10,
    },
  ],
  voices: [
    {
      id: "voice-primary",
      name: "Primary voice",
      createdAt: CREATED_AT + 11,
      updatedAt: UPDATED_AT + 11,
    },
  ],
  voiceSamples: [
    {
      id: "voice-sample-1",
      voiceId: "voice-primary",
      content: "A representative voice sample.",
      createdAt: CREATED_AT + 12,
      updatedAt: UPDATED_AT + 12,
    },
  ],
  settings: [
    {
      id: "app",
      theme: "dark",
      userProfile: { displayName: "Ariel" },
      updatedAt: UPDATED_AT + 13,
    },
  ],
};

async function seedLibrary(): Promise<void> {
  for (const collection of SYNCED_COLLECTIONS) {
    await tableFor(collection).bulkPut(library[collection]);
  }
}

async function collectionCounts(): Promise<number[]> {
  return Promise.all(
    SYNCED_COLLECTIONS.map((collection) => tableFor(collection).count()),
  );
}

describe("library backup round trip", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
  });

  it("restores identical synced state after the IndexedDB profile is wiped", async () => {
    await seedLibrary();

    const exported = await createLibraryBackup();
    const fileContents = JSON.stringify(exported);

    await db.delete();
    await db.open();
    expect(await collectionCounts()).toEqual(SYNCED_COLLECTIONS.map(() => 0));

    const imported = await restoreLibraryBackup(parseLibraryBackup(fileContents));
    const restored = await createLibraryBackup();

    expect(imported).toBe(
      SYNCED_COLLECTIONS.reduce(
        (total, collection) => total + library[collection].length,
        0,
      ),
    );
    expect(restored.collections).toEqual(exported.collections);
    expect(await db.ideas.get("idea-child")).toMatchObject({
      id: "idea-child",
      parentId: "idea-root",
      deletedAt: DELETED_AT + 4,
      createdAt: CREATED_AT + 4,
      updatedAt: UPDATED_AT + 4,
    });
    expect(await db.contentPieces.get("piece-tombstone")).toMatchObject({
      id: "piece-tombstone",
      ideaId: "idea-child",
      status: "ready",
      deletedAt: DELETED_AT + 6,
      createdAt: CREATED_AT + 6,
      updatedAt: UPDATED_AT + 6,
    });
    expect(await db.resources.get("resource-piece")).toMatchObject({
      id: "resource-piece",
      ownerType: "piece",
      ownerId: "piece-published",
      createdAt: CREATED_AT + 8,
    });
    expect(await db.comments.get("comment-draft")).toMatchObject({
      id: "comment-draft",
      noteId: "note-draft",
      ideaId: null,
      promotedIdeaId: "idea-child",
      createdAt: CREATED_AT + 10,
      updatedAt: UPDATED_AT + 10,
    });
  });
});
