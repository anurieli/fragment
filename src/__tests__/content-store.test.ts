import { describe, it, expect, beforeEach, vi } from "vitest";

import { useContentStore } from "@/stores/content-store";
import { ContractError } from "@/lib/content-engine";

// Mock the persistence layer — the store calls these on every mutation — but
// keep the real guard functions (assertPublishGuard) and ContractError so
// the store's synchronous validation behaves exactly as it does in prod.
vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>(
    "@/lib/persistence",
  );
  return {
    ...actual,
    saveIdea: vi.fn().mockResolvedValue(undefined),
    savePiece: vi.fn().mockResolvedValue(undefined),
  };
});

function resetStore() {
  useContentStore.setState({
    ideas: {},
    pieces: {},
    hydrated: true,
  });
}

describe("content-store — ideas", () => {
  beforeEach(resetStore);

  it("createIdea adds a root idea and returns its id", () => {
    const id = useContentStore.getState().createIdea({ title: "Agentic writing" });
    const idea = useContentStore.getState().ideas[id];

    expect(idea).toBeDefined();
    expect(idea.title).toBe("Agentic writing");
    expect(idea.parentId).toBeNull();
    expect(idea.priority).toBe(0);
    expect(idea.origin).toBe("user");
  });

  it("createIdea is a no-op before hydration", () => {
    useContentStore.setState({ hydrated: false });
    const id = useContentStore.getState().createIdea({ title: "Too early" });
    expect(id).toBe("");
    expect(Object.keys(useContentStore.getState().ideas)).toHaveLength(0);
  });

  it("createIdea accepts a root idea as parent (depth 2)", () => {
    const rootId = useContentStore.getState().createIdea({ title: "Root" });
    const childId = useContentStore
      .getState()
      .createIdea({ title: "Child", parentId: rootId });
    expect(useContentStore.getState().ideas[childId].parentId).toBe(rootId);
  });

  it("createIdea rejects nesting a child under a child (depth > 2)", () => {
    const rootId = useContentStore.getState().createIdea({ title: "Root" });
    const childId = useContentStore
      .getState()
      .createIdea({ title: "Child", parentId: rootId });

    expect(() =>
      useContentStore.getState().createIdea({ title: "Grandchild", parentId: childId }),
    ).toThrow(ContractError);
  });

  it("createIdea rejects a parentId that doesn't exist", () => {
    expect(() =>
      useContentStore.getState().createIdea({ title: "Orphan", parentId: "missing" }),
    ).toThrow(ContractError);
  });

  it("updateIdea patches editable fields and bumps updatedAt", () => {
    const id = useContentStore.getState().createIdea({ title: "Draft" });
    const before = useContentStore.getState().ideas[id].updatedAt;

    useContentStore.getState().updateIdea(id, { title: "Renamed", summary: "New summary" });
    const after = useContentStore.getState().ideas[id];

    expect(after.title).toBe("Renamed");
    expect(after.summary).toBe("New summary");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("deleteIdea tombstones (sets deletedAt) instead of removing the row", () => {
    const id = useContentStore.getState().createIdea({ title: "To delete" });
    useContentStore.getState().deleteIdea(id);

    const idea = useContentStore.getState().ideas[id];
    expect(idea).toBeDefined();
    expect(idea.deletedAt).toBeDefined();
  });

  it("undeleteIdea restores a tombstoned idea", () => {
    const id = useContentStore.getState().createIdea({ title: "To delete" });
    useContentStore.getState().deleteIdea(id);
    useContentStore.getState().undeleteIdea(id);

    expect(useContentStore.getState().ideas[id].deletedAt).toBeUndefined();
  });

  it("setIdeaPriority sets an explicit priority", () => {
    const id = useContentStore.getState().createIdea({ title: "P" });
    useContentStore.getState().setIdeaPriority(id, 2);
    expect(useContentStore.getState().ideas[id].priority).toBe(2);
  });

  it("cycleIdeaPriority cycles 0 -> 1 -> 2 -> 3 -> 4 -> 0", () => {
    const id = useContentStore.getState().createIdea({ title: "P" });
    const store = useContentStore.getState();
    const expected = [1, 2, 3, 4, 0];
    for (const priority of expected) {
      store.cycleIdeaPriority(id);
      expect(useContentStore.getState().ideas[id].priority).toBe(priority);
    }
  });

  it("pinIdea sets pinnedAt; unpinIdea clears it", () => {
    const id = useContentStore.getState().createIdea({ title: "Pin me" });
    useContentStore.getState().pinIdea(id);
    expect(useContentStore.getState().ideas[id].pinnedAt).toBeDefined();

    useContentStore.getState().unpinIdea(id);
    expect(useContentStore.getState().ideas[id].pinnedAt).toBeUndefined();
  });
});

describe("content-store — pieces", () => {
  beforeEach(resetStore);

  function makeIdea(): string {
    return useContentStore.getState().createIdea({ title: "Parent idea" });
  }

  it("createPiece with body (short-form) succeeds", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "tweet",
      origin: "user",
      body: "hot take",
    });
    const piece = useContentStore.getState().pieces[id];
    expect(piece.body).toBe("hot take");
    expect(piece.noteId).toBeUndefined();
    expect(piece.status).toBe("inbox");
    expect(piece.seen).toBe(false);
    expect(piece.order).toBe(0);
  });

  it("createPiece with noteId (long-form) succeeds", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "essay",
      origin: "user",
      noteId: "note-1",
    });
    expect(useContentStore.getState().pieces[id].noteId).toBe("note-1");
  });

  it("createPiece rejects neither noteId nor body", () => {
    const ideaId = makeIdea();
    expect(() =>
      useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user" }),
    ).toThrow(ContractError);
  });

  it("createPiece rejects both noteId and body", () => {
    const ideaId = makeIdea();
    expect(() =>
      useContentStore.getState().createPiece({
        ideaId,
        format: "tweet",
        origin: "user",
        noteId: "note-1",
        body: "text",
      }),
    ).toThrow(ContractError);
  });

  it("createPiece scopes default order per idea", () => {
    const ideaA = makeIdea();
    const ideaB = makeIdea();
    const a1 = useContentStore.getState().createPiece({ ideaId: ideaA, format: "tweet", origin: "user", body: "a1" });
    const a2 = useContentStore.getState().createPiece({ ideaId: ideaA, format: "tweet", origin: "user", body: "a2" });
    const b1 = useContentStore.getState().createPiece({ ideaId: ideaB, format: "tweet", origin: "user", body: "b1" });

    expect(useContentStore.getState().pieces[a1].order).toBe(0);
    expect(useContentStore.getState().pieces[a2].order).toBe(1);
    expect(useContentStore.getState().pieces[b1].order).toBe(0);
  });

  it("reorderPieces applies order updates in bulk", () => {
    const ideaId = makeIdea();
    const a = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "a" });
    const b = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "b" });

    useContentStore.getState().reorderPieces([
      { id: a, order: 5 },
      { id: b, order: 2 },
    ]);

    expect(useContentStore.getState().pieces[a].order).toBe(5);
    expect(useContentStore.getState().pieces[b].order).toBe(2);
  });

  it("setPieceStatus rejects moving to published without a publish record", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });

    expect(() => useContentStore.getState().setPieceStatus(id, "published")).toThrow(
      ContractError,
    );
  });

  it("setPieceStatus accepts moving to published with a publish record", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });

    useContentStore.getState().setPieceStatus(id, "published", {
      platform: "tweet",
      method: "manual",
      publishedAt: Date.now(),
      verified: true,
    });

    const piece = useContentStore.getState().pieces[id];
    expect(piece.status).toBe("published");
    expect(piece.publish?.verified).toBe(true);
  });

  it("setPieceStatus clears the publish record when moving away from published", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });
    useContentStore.getState().setPieceStatus(id, "published", {
      platform: "tweet",
      method: "manual",
      publishedAt: Date.now(),
      verified: true,
    });

    useContentStore.getState().setPieceStatus(id, "ready");

    const piece = useContentStore.getState().pieces[id];
    expect(piece.status).toBe("ready");
    expect(piece.publish).toBeUndefined();
  });

  it("markPieceSeen flips seen to true once", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });
    expect(useContentStore.getState().pieces[id].seen).toBe(false);

    useContentStore.getState().markPieceSeen(id);
    expect(useContentStore.getState().pieces[id].seen).toBe(true);
  });

  it("setPiecePriority sets an explicit priority", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });
    useContentStore.getState().setPiecePriority(id, 1);
    expect(useContentStore.getState().pieces[id].priority).toBe(1);
  });

  it("cyclePiecePriority cycles 0 -> 1 -> 2 -> 3 -> 4 -> 0", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });
    const expected = [1, 2, 3, 4, 0];
    for (const priority of expected) {
      useContentStore.getState().cyclePiecePriority(id);
      expect(useContentStore.getState().pieces[id].priority).toBe(priority);
    }
  });

  it("rejectPiece tombstones; undeletePiece restores (undo)", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });

    useContentStore.getState().rejectPiece(id);
    expect(useContentStore.getState().pieces[id].deletedAt).toBeDefined();

    useContentStore.getState().undeletePiece(id);
    expect(useContentStore.getState().pieces[id].deletedAt).toBeUndefined();
  });

  it("detachPieceNote tombstones every live piece linking that note, in memory", () => {
    const ideaId = makeIdea();
    const linked = useContentStore.getState().createPiece({
      ideaId,
      format: "essay",
      origin: "user",
      noteId: "note-1",
    });
    const unrelated = useContentStore.getState().createPiece({
      ideaId,
      format: "essay",
      origin: "user",
      noteId: "note-2",
    });

    useContentStore.getState().detachPieceNote("note-1");

    expect(useContentStore.getState().pieces[linked].deletedAt).toBeDefined();
    expect(useContentStore.getState().pieces[unrelated].deletedAt).toBeUndefined();
  });

  it("updatePiece re-validates the content-home guard on edit", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });

    expect(() =>
      useContentStore.getState().updatePiece(id, { noteId: "note-1" }),
    ).toThrow(ContractError);
  });
});
