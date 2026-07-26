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
    saveResource: vi.fn().mockResolvedValue(undefined),
    deleteResourceRow: vi.fn().mockResolvedValue(undefined),
  };
});

function resetStore() {
  useContentStore.setState({
    ideas: {},
    pieces: {},
    resources: {},
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

  it("deleteIdeaCascade tombstones the idea, its children, and their pieces", () => {
    const store = useContentStore.getState();
    const rootId = store.createIdea({ title: "Root" });
    const childId = store.createIdea({ title: "Child", parentId: rootId });
    const rootPiece = store.createPiece({ ideaId: rootId, format: "tweet", origin: "user", body: "a" });
    const childPiece = store.createPiece({ ideaId: childId, format: "tweet", origin: "user", body: "b" });

    const cascade = useContentStore.getState().deleteIdeaCascade(rootId);
    const after = useContentStore.getState();

    expect(cascade.ideaIds.sort()).toEqual([rootId, childId].sort());
    expect(cascade.pieceIds.sort()).toEqual([rootPiece, childPiece].sort());
    expect(after.ideas[rootId].deletedAt).toBeDefined();
    expect(after.ideas[childId].deletedAt).toBeDefined();
    expect(after.pieces[rootPiece].deletedAt).toBeDefined();
    expect(after.pieces[childPiece].deletedAt).toBeDefined();
  });

  it("deleteIdeaCascade leaves other ideas' pieces alone", () => {
    const store = useContentStore.getState();
    const doomedId = store.createIdea({ title: "Doomed" });
    const keptId = store.createIdea({ title: "Kept" });
    const keptPiece = store.createPiece({ ideaId: keptId, format: "tweet", origin: "user", body: "keep" });

    useContentStore.getState().deleteIdeaCascade(doomedId);

    expect(useContentStore.getState().ideas[keptId].deletedAt).toBeUndefined();
    expect(useContentStore.getState().pieces[keptPiece].deletedAt).toBeUndefined();
  });

  it("restoreIdeaCascade undoes exactly what the cascade deleted", () => {
    const store = useContentStore.getState();
    const rootId = store.createIdea({ title: "Root" });
    const childId = store.createIdea({ title: "Child", parentId: rootId });
    const pieceId = store.createPiece({ ideaId: childId, format: "tweet", origin: "user", body: "b" });
    // Already-deleted content must NOT come back with the undo.
    const stalePiece = store.createPiece({ ideaId: rootId, format: "tweet", origin: "user", body: "old" });
    useContentStore.getState().rejectPiece(stalePiece);

    const cascade = useContentStore.getState().deleteIdeaCascade(rootId);
    useContentStore.getState().restoreIdeaCascade(cascade);
    const after = useContentStore.getState();

    expect(after.ideas[rootId].deletedAt).toBeUndefined();
    expect(after.ideas[childId].deletedAt).toBeUndefined();
    expect(after.pieces[pieceId].deletedAt).toBeUndefined();
    expect(after.pieces[stalePiece].deletedAt).toBeDefined();
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

  it("linkNoteToIdea creates the long-form piece that puts a note inside an idea", () => {
    const ideaId = makeIdea();
    const pieceId = useContentStore.getState().linkNoteToIdea(ideaId, "note-1", "My essay");
    const piece = useContentStore.getState().pieces[pieceId];

    expect(piece.ideaId).toBe(ideaId);
    expect(piece.noteId).toBe("note-1");
    expect(piece.body).toBeUndefined();
    expect(piece.title).toBe("My essay");
    expect(piece.status).toBe("in-progress");
    // Hand-made, so it never shows up as an unseen arrival.
    expect(piece.seen).toBe(true);
  });

  it("linkNoteToIdea is idempotent — a note is never linked twice", () => {
    const ideaId = makeIdea();
    const first = useContentStore.getState().linkNoteToIdea(ideaId, "note-1");
    const second = useContentStore.getState().linkNoteToIdea(ideaId, "note-1");

    expect(second).toBe(first);
    expect(Object.keys(useContentStore.getState().pieces)).toHaveLength(1);
  });

  it("linkNoteToIdea ignores an unknown idea", () => {
    expect(useContentStore.getState().linkNoteToIdea("missing", "note-1")).toBe("");
    expect(Object.keys(useContentStore.getState().pieces)).toHaveLength(0);
  });

  it("convertPieceToDraft swaps the content home and pulls the piece out of the inbox", () => {
    const ideaId = makeIdea();
    const pieceId = useContentStore.getState().createPiece({
      ideaId,
      format: "substack",
      origin: "agent",
      body: "# An essay\n\nThat an agent dropped in.",
      agentMeta: { agent: "penny", pushedAt: 1 },
    });

    const previousBody = useContentStore.getState().convertPieceToDraft(pieceId, "note-9");
    const piece = useContentStore.getState().pieces[pieceId];

    expect(previousBody).toBe("# An essay\n\nThat an agent dropped in.");
    expect(piece.noteId).toBe("note-9");
    expect(piece.body).toBeUndefined();
    expect(piece.status).toBe("in-progress");
    expect(piece.seen).toBe(true);
    // Provenance survives the move — this is the same piece, rehoused.
    expect(piece.agentMeta?.agent).toBe("penny");
    expect(piece.id).toBe(pieceId);
  });

  it("convertPieceToDraft leaves a piece that's already further along at its stage", () => {
    const ideaId = makeIdea();
    const pieceId = useContentStore.getState().createPiece({
      ideaId, format: "essay", origin: "user", body: "text", status: "ready",
    });

    useContentStore.getState().convertPieceToDraft(pieceId, "note-1");
    expect(useContentStore.getState().pieces[pieceId].status).toBe("ready");
  });

  it("convertPieceToDraft refuses a piece that already lives in a note", () => {
    const ideaId = makeIdea();
    const pieceId = useContentStore.getState().linkNoteToIdea(ideaId, "note-1");

    expect(useContentStore.getState().convertPieceToDraft(pieceId, "note-2")).toBeNull();
    expect(useContentStore.getState().pieces[pieceId].noteId).toBe("note-1");
  });

  it("revertPieceToShortform puts the body back, exactly, and clears the note link", () => {
    const ideaId = makeIdea();
    const body = "Line one.   \n\n\nLine two.  ";
    const pieceId = useContentStore.getState().createPiece({
      ideaId, format: "substack", origin: "agent", body,
    });

    const previousBody = useContentStore.getState().convertPieceToDraft(pieceId, "note-9");
    useContentStore.getState().revertPieceToShortform(pieceId, previousBody as string, "inbox");
    const piece = useContentStore.getState().pieces[pieceId];

    expect(piece.body).toBe(body);
    expect(piece.noteId).toBeUndefined();
    expect(piece.status).toBe("inbox");
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

describe("content-store — resources", () => {
  beforeEach(resetStore);

  function makeIdea(): string {
    return useContentStore.getState().createIdea({ title: "Parent idea" });
  }

  it("addResource creates an idea-owned resource and returns its id", () => {
    const ideaId = makeIdea();
    const id = useContentStore
      .getState()
      .addResource("idea", ideaId, { kind: "link", url: "https://example.com", title: "Example" });

    const resource = useContentStore.getState().resources[id];
    expect(resource).toBeDefined();
    expect(resource.ownerType).toBe("idea");
    expect(resource.ownerId).toBe(ideaId);
    expect(resource.title).toBe("Example");
    expect(resource.url).toBe("https://example.com");
  });

  it("addResource creates a piece-owned resource", () => {
    const ideaId = makeIdea();
    const pieceId = useContentStore
      .getState()
      .createPiece({ ideaId, format: "tweet", origin: "user", body: "x" });
    const id = useContentStore.getState().addResource("piece", pieceId, { kind: "note", title: "Context" });

    const resource = useContentStore.getState().resources[id];
    expect(resource.ownerType).toBe("piece");
    expect(resource.ownerId).toBe(pieceId);
    expect(resource.kind).toBe("note");
  });

  it("addResource is a no-op before hydration", () => {
    useContentStore.setState({ hydrated: false });
    const id = useContentStore.getState().addResource("idea", "idea-1", { kind: "link", title: "x" });
    expect(id).toBe("");
    expect(Object.keys(useContentStore.getState().resources)).toHaveLength(0);
  });

  it("removeResource hard-deletes — the row is gone, not tombstoned", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().addResource("idea", ideaId, { kind: "link", title: "x" });
    expect(useContentStore.getState().resources[id]).toBeDefined();

    useContentStore.getState().removeResource(id);
    expect(useContentStore.getState().resources[id]).toBeUndefined();
  });

  it("listResources returns every resource currently in the store", () => {
    const ideaId = makeIdea();
    useContentStore.getState().addResource("idea", ideaId, { kind: "link", title: "a" });
    useContentStore.getState().addResource("idea", ideaId, { kind: "note", title: "b" });
    expect(useContentStore.getState().listResources()).toHaveLength(2);
  });
});
