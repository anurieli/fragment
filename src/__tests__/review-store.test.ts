import { describe, it, expect, beforeEach } from "vitest";
import { useReviewStore } from "@/stores/review-store";
import { db } from "@/lib/db";
import type { ReviewReturn } from "@/lib/types";

async function reset() {
  await db.reviews.clear();
  useReviewStore.setState({ reviews: {}, loadedNoteIds: new Set() });
}

function makeReturn(overrides: Partial<ReviewReturn> = {}): ReviewReturn {
  return {
    docId: "doc-1",
    reviewerName: "Jamie",
    timestamp: 1_700_000_000_000,
    comments: [{ id: "c1", anchorText: "hook", prefix: "", suffix: "", body: "Great hook" }],
    ...overrides,
  };
}

describe("review-store", () => {
  beforeEach(reset);

  it("saveReviewReturn stores a review keyed to the note and persists it to Dexie", async () => {
    const stored = await useReviewStore.getState().saveReviewReturn("note-1", makeReturn());
    expect(stored.noteId).toBe("note-1");
    expect(stored.id).toBeTruthy();
    expect(stored.receivedAt).toBeGreaterThan(0);
    expect(useReviewStore.getState().reviews[stored.id]).toEqual(stored);

    const rows = await db.reviews.where("noteId").equals("note-1").toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewerName).toBe("Jamie");
  });

  it("listForNote returns only reviews for that note, newest first", async () => {
    const a = await useReviewStore.getState().saveReviewReturn("note-1", makeReturn({ reviewerName: "A" }));
    await new Promise((r) => setTimeout(r, 2));
    const b = await useReviewStore.getState().saveReviewReturn("note-1", makeReturn({ reviewerName: "B" }));
    await useReviewStore.getState().saveReviewReturn("note-2", makeReturn({ reviewerName: "C" }));

    const list = useReviewStore.getState().listForNote("note-1");
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(list.every((r) => r.noteId === "note-1")).toBe(true);
  });

  it("loadForNote hydrates from Dexie and is idempotent", async () => {
    await useReviewStore.getState().saveReviewReturn("note-1", makeReturn());
    // Simulate a fresh session: clear in-memory state but keep the Dexie row.
    useReviewStore.setState({ reviews: {}, loadedNoteIds: new Set() });

    await useReviewStore.getState().loadForNote("note-1");
    expect(useReviewStore.getState().listForNote("note-1")).toHaveLength(1);

    // Calling again shouldn't duplicate or error.
    await useReviewStore.getState().loadForNote("note-1");
    expect(useReviewStore.getState().listForNote("note-1")).toHaveLength(1);
  });

  it("removeReview deletes from both memory and Dexie", async () => {
    const stored = await useReviewStore.getState().saveReviewReturn("note-1", makeReturn());
    await useReviewStore.getState().removeReview(stored.id);
    expect(useReviewStore.getState().reviews[stored.id]).toBeUndefined();
    const rows = await db.reviews.where("noteId").equals("note-1").toArray();
    expect(rows).toHaveLength(0);
  });
});
