import { describe, it, expect, beforeEach } from "vitest";
import { useReviewStore } from "@/stores/review-store";
import { useContentStore } from "@/stores/content-store";
import { db } from "@/lib/db";
import type { ReviewReturn } from "@/lib/types";
import type { ContentPiece } from "@/lib/content-engine";

async function reset() {
  await db.reviews.clear();
  useReviewStore.setState({ reviews: {}, loadedPieceIds: new Set() });
  useContentStore.setState({ pieces: {} });
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

function seedPiece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  const piece: ContentPiece = {
    id: "piece-1",
    ideaId: "idea-1",
    format: "essay",
    status: "in-progress",
    origin: "user",
    body: "the draft",
    seen: true,
    priority: 0,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
  useContentStore.setState((s) => ({ pieces: { ...s.pieces, [piece.id]: piece } }));
  return piece;
}

describe("review-store", () => {
  beforeEach(reset);

  it("saveReviewReturn stores a review keyed to the fragment and persists it to Dexie", async () => {
    const stored = await useReviewStore.getState().saveReviewReturn("piece-1", makeReturn());
    expect(stored.pieceId).toBe("piece-1");
    expect(stored.id).toBeTruthy();
    expect(stored.receivedAt).toBeGreaterThan(0);
    expect(useReviewStore.getState().reviews[stored.id]).toEqual(stored);

    const rows = await db.reviews.where("pieceId").equals("piece-1").toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewerName).toBe("Jamie");
  });

  it("files a migrated fragment's review under the note it was shared as", async () => {
    // The share key is what the server side of the conversation knows the
    // fragment by, so a review that comes back for a link minted before the
    // switchover still lands on the same fragment.
    seedPiece({ legacyNoteId: "note-legacy" });

    const stored = await useReviewStore.getState().saveReviewReturn("piece-1", makeReturn());

    expect(stored.noteId).toBe("note-legacy");
    expect(useReviewStore.getState().listForPiece("piece-1")).toHaveLength(1);
  });

  it("listForPiece returns only reviews for that fragment, newest first", async () => {
    const a = await useReviewStore.getState().saveReviewReturn("piece-1", makeReturn({ reviewerName: "A" }));
    await new Promise((r) => setTimeout(r, 2));
    const b = await useReviewStore.getState().saveReviewReturn("piece-1", makeReturn({ reviewerName: "B" }));
    await useReviewStore.getState().saveReviewReturn("piece-2", makeReturn({ reviewerName: "C" }));

    const list = useReviewStore.getState().listForPiece("piece-1");
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(list.every((r) => r.pieceId === "piece-1")).toBe(true);
  });

  it("loadForPiece hydrates from Dexie and is idempotent", async () => {
    await useReviewStore.getState().saveReviewReturn("piece-1", makeReturn());
    // Simulate a fresh session: clear in-memory state but keep the Dexie row.
    useReviewStore.setState({ reviews: {}, loadedPieceIds: new Set() });

    await useReviewStore.getState().loadForPiece("piece-1");
    expect(useReviewStore.getState().listForPiece("piece-1")).toHaveLength(1);

    // Calling again shouldn't duplicate or error.
    await useReviewStore.getState().loadForPiece("piece-1");
    expect(useReviewStore.getState().listForPiece("piece-1")).toHaveLength(1);
  });

  it("removeReview deletes from both memory and Dexie", async () => {
    const stored = await useReviewStore.getState().saveReviewReturn("piece-1", makeReturn());
    await useReviewStore.getState().removeReview(stored.id);
    expect(useReviewStore.getState().reviews[stored.id]).toBeUndefined();
    const rows = await db.reviews.where("pieceId").equals("piece-1").toArray();
    expect(rows).toHaveLength(0);
  });
});
