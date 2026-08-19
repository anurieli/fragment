import { describe, it, expect, beforeEach, vi } from "vitest";

import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";
import { ContractError, isLongformFormat } from "@/lib/content-engine";

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

  // reparentIdea is what the sidebar's "Group under a new idea" bulk action
  // runs on every ticked row, so the one-level nesting rule has to hold when
  // ideas are moved, not just when they are created.
  it("reparentIdea moves a root idea under another root", () => {
    const parentId = useContentStore.getState().createIdea({ title: "Parent" });
    const id = useContentStore.getState().createIdea({ title: "Loose" });

    expect(useContentStore.getState().reparentIdea(id, parentId)).toBe(true);
    expect(useContentStore.getState().ideas[id].parentId).toBe(parentId);
  });

  it("reparentIdea moves a child back out to the top level", () => {
    const parentId = useContentStore.getState().createIdea({ title: "Parent" });
    const id = useContentStore
      .getState()
      .createIdea({ title: "Child", parentId });

    expect(useContentStore.getState().reparentIdea(id, null)).toBe(true);
    expect(useContentStore.getState().ideas[id].parentId).toBeNull();
  });

  it("reparentIdea refuses to nest under a child idea (depth > 2)", () => {
    const rootId = useContentStore.getState().createIdea({ title: "Root" });
    const childId = useContentStore
      .getState()
      .createIdea({ title: "Child", parentId: rootId });
    const id = useContentStore.getState().createIdea({ title: "Loose" });

    expect(useContentStore.getState().reparentIdea(id, childId)).toBe(false);
    expect(useContentStore.getState().ideas[id].parentId).toBeNull();
  });

  it("reparentIdea refuses to move an idea that has sub-ideas of its own", () => {
    const parentId = useContentStore.getState().createIdea({ title: "Parent" });
    const id = useContentStore.getState().createIdea({ title: "Has kids" });
    useContentStore.getState().createIdea({ title: "Kid", parentId: id });

    expect(useContentStore.getState().reparentIdea(id, parentId)).toBe(false);
    expect(useContentStore.getState().ideas[id].parentId).toBeNull();
  });

  it("reparentIdea refuses an idea as its own parent, a missing parent, and a deleted one", () => {
    const id = useContentStore.getState().createIdea({ title: "Loose" });
    const goneId = useContentStore.getState().createIdea({ title: "Gone" });
    useContentStore.getState().deleteIdea(goneId);

    expect(useContentStore.getState().reparentIdea(id, id)).toBe(false);
    expect(useContentStore.getState().reparentIdea(id, "missing")).toBe(false);
    expect(useContentStore.getState().reparentIdea(id, goneId)).toBe(false);
    expect(useContentStore.getState().ideas[id].parentId).toBeNull();
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
    const rootPiece = store.createPiece({ ideaId: rootId, format: "tweet", origin: "user", status: "inbox", body: "a" });
    const childPiece = store.createPiece({ ideaId: childId, format: "tweet", origin: "user", status: "inbox", body: "b" });

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
    const keptPiece = store.createPiece({ ideaId: keptId, format: "tweet", origin: "user", status: "inbox", body: "keep" });

    useContentStore.getState().deleteIdeaCascade(doomedId);

    expect(useContentStore.getState().ideas[keptId].deletedAt).toBeUndefined();
    expect(useContentStore.getState().pieces[keptPiece].deletedAt).toBeUndefined();
  });

  it("restoreIdeaCascade undoes exactly what the cascade deleted", () => {
    const store = useContentStore.getState();
    const rootId = store.createIdea({ title: "Root" });
    const childId = store.createIdea({ title: "Child", parentId: rootId });
    const pieceId = store.createPiece({ ideaId: childId, format: "tweet", origin: "user", status: "inbox", body: "b" });
    // Already-deleted content must NOT come back with the undo.
    const stalePiece = store.createPiece({ ideaId: rootId, format: "tweet", origin: "user", status: "inbox", body: "old" });
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

  it("createPiece stores the fragment's text on the fragment itself", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "tweet",
      origin: "user",
      status: "inbox",
      body: "hot take",
    });
    const piece = useContentStore.getState().pieces[id];
    expect(piece.body).toBe("hot take");
    // Stored as given. createPiece has no status default, so this asserts
    // pass-through rather than a fallback being exercised.
    expect(piece.status).toBe("inbox");
    expect(piece.seen).toBe(false);
    expect(piece.order).toBe(0);
  });

  /**
   * The rule the required field exists to enforce: "inbox" is where work
   * arrives from somewhere other than the person at the keyboard. Nothing a
   * writer does inside the app produces one. This pins the store half; the
   * call sites are checked by the compiler, which is the whole reason
   * `status` is required rather than defaulted.
   */
  it("createPiece never invents a status, so in-app writing cannot land in the inbox", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "other",
      origin: "user",
      status: "in-progress",
      body: "mine",
      seen: true,
    });
    const piece = useContentStore.getState().pieces[id];
    expect(piece.status).toBe("in-progress");
    expect(piece.seen).toBe(true);
  });

  it("createPiece gives a fragment created with no text an empty body", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "essay",
      origin: "user",
      status: "inbox",
    });
    expect(useContentStore.getState().pieces[id].body).toBe("");
  });

  it("createPiece scopes default order per idea", () => {
    const ideaA = makeIdea();
    const ideaB = makeIdea();
    const a1 = useContentStore.getState().createPiece({ ideaId: ideaA, format: "tweet", origin: "user", status: "inbox", body: "a1" });
    const a2 = useContentStore.getState().createPiece({ ideaId: ideaA, format: "tweet", origin: "user", status: "inbox", body: "a2" });
    const b1 = useContentStore.getState().createPiece({ ideaId: ideaB, format: "tweet", origin: "user", status: "inbox", body: "b1" });

    expect(useContentStore.getState().pieces[a1].order).toBe(0);
    expect(useContentStore.getState().pieces[a2].order).toBe(1);
    expect(useContentStore.getState().pieces[b1].order).toBe(0);
  });

  it("reorderPieces applies order updates in bulk", () => {
    const ideaId = makeIdea();
    const a = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "a" });
    const b = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "b" });

    useContentStore.getState().reorderPieces([
      { id: a, order: 5 },
      { id: b, order: 2 },
    ]);

    expect(useContentStore.getState().pieces[a].order).toBe(5);
    expect(useContentStore.getState().pieces[b].order).toBe(2);
  });

  it("setPieceStatus rejects moving to published without a publish record", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });

    expect(() => useContentStore.getState().setPieceStatus(id, "published")).toThrow(
      ContractError,
    );
  });

  it("setPieceStatus accepts moving to published with a publish record", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });

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
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });
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
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });
    expect(useContentStore.getState().pieces[id].seen).toBe(false);

    useContentStore.getState().markPieceSeen(id);
    expect(useContentStore.getState().pieces[id].seen).toBe(true);
  });

  it("setPiecePriority sets an explicit priority", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });
    useContentStore.getState().setPiecePriority(id, 1);
    expect(useContentStore.getState().pieces[id].priority).toBe(1);
  });

  it("cyclePiecePriority cycles 0 -> 1 -> 2 -> 3 -> 4 -> 0", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });
    const expected = [1, 2, 3, 4, 0];
    for (const priority of expected) {
      useContentStore.getState().cyclePiecePriority(id);
      expect(useContentStore.getState().pieces[id].priority).toBe(priority);
    }
  });

  it("rejectPiece tombstones; undeletePiece restores (undo)", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });

    useContentStore.getState().rejectPiece(id);
    expect(useContentStore.getState().pieces[id].deletedAt).toBeDefined();

    useContentStore.getState().undeletePiece(id);
    expect(useContentStore.getState().pieces[id].deletedAt).toBeUndefined();
  });

  it("updatePiece on an unknown id changes nothing", () => {
    useContentStore.getState().updatePiece("missing", { body: "x" });
    expect(Object.keys(useContentStore.getState().pieces)).toHaveLength(0);
  });

  it("setPieces hydrates the library from an array", () => {
    useContentStore.getState().setPieces([
      {
        id: "p1",
        ideaId: "i1",
        format: "essay",
        status: "in-progress",
        origin: "user",
        body: "the words",
        seen: true,
        priority: 0,
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);
    expect(useContentStore.getState().pieces["p1"].body).toBe("the words");
  });

  it("updatePiece re-validates the publish guard on edit", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });

    expect(() =>
      useContentStore.getState().updatePiece(id, {
        publish: { platform: "tweet", method: "manual", publishedAt: Date.now(), verified: true },
      }),
    ).toThrow(ContractError);
  });

  it("updatePiece is where a fragment's text and brief are edited", () => {
    const ideaId = makeIdea();
    const id = useContentStore.getState().createPiece({ ideaId, format: "essay", origin: "user", status: "inbox", });

    useContentStore.getState().updatePiece(id, {
      body: "The opening paragraph.",
      title: "A title",
      goal: "Convince the reader",
      voiceId: null,
    });

    const piece = useContentStore.getState().pieces[id];
    expect(piece.body).toBe("The opening paragraph.");
    expect(piece.title).toBe("A title");
    expect(piece.goal).toBe("Convince the reader");
    // null is "explicitly no voice", which is not the same as inheriting the
    // default, so it has to survive the round trip as null.
    expect(piece.voiceId).toBeNull();
  });
});

describe("content-store — published text is closed", () => {
  beforeEach(resetStore);

  function publishedPiece(body = "shipped words"): string {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    const id = store.createPiece({
      ideaId,
      format: "substack",
      origin: "user",
      status: "in-progress",
      body,
    });
    useContentStore.getState().setPieceStatus(id, "published", {
      platform: "substack",
      method: "manual",
      publishedAt: 1000,
      url: "https://example.substack.com/p/shipped",
      verified: true,
    });
    return id;
  }

  it("a published piece starts undiverged", () => {
    const id = publishedPiece();
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBeUndefined();
  });

  it("changing a published piece's body stamps that it diverged", () => {
    const id = publishedPiece();
    useContentStore.getState().updatePiece(id, { body: "shipped words, fixed" });
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBeGreaterThan(0);
  });

  it("stamps once and keeps the first time, since a later edit does not undo the divergence", () => {
    const id = publishedPiece();
    useContentStore.getState().updatePiece(id, { body: "first fix" });
    const first = useContentStore.getState().pieces[id].editedAfterPublishAt;
    useContentStore.getState().updatePiece(id, { body: "second fix" });
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBe(first);
  });

  it("writing the same body is not a change", () => {
    const id = publishedPiece("shipped words");
    useContentStore.getState().updatePiece(id, { body: "shipped words" });
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBeUndefined();
  });

  it("editing a field other than the body is not a divergence", () => {
    const id = publishedPiece();
    useContentStore.getState().updatePiece(id, { title: "A better title" });
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBeUndefined();
  });

  it("an unpublished piece is never stamped", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    const id = store.createPiece({ ideaId, format: "tweet", origin: "user", status: "ready", body: "a" });
    useContentStore.getState().updatePiece(id, { body: "b" });
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBeUndefined();
  });

  it("a status change clears the divergence, in both directions", () => {
    const id = publishedPiece();
    useContentStore.getState().updatePiece(id, { body: "edited" });
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBeGreaterThan(0);

    // Back to a working state: the field is meaningless off "published".
    useContentStore.getState().setPieceStatus(id, "ready");
    expect(useContentStore.getState().pieces[id].editedAfterPublishAt).toBeUndefined();
  });

  it("duplicatePiece copies words and brief but none of the publish history", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    const sourceId = store.createPiece({
      ideaId,
      format: "substack",
      origin: "user",
      status: "in-progress",
      body: "shipped words",
      title: "Shipped",
    });
    useContentStore.getState().updatePiece(sourceId, { goal: "Convince the reader", tone: "dry" });
    useContentStore.getState().setPieceStatus(sourceId, "published", {
      platform: "substack",
      method: "manual",
      publishedAt: 1000,
      verified: false,
    });

    const copyId = useContentStore.getState().duplicatePiece(sourceId);
    const copy = useContentStore.getState().pieces[copyId];

    expect(copy.body).toBe("shipped words");
    expect(copy.goal).toBe("Convince the reader");
    expect(copy.tone).toBe("dry");
    expect(copy.ideaId).toBe(ideaId);
    expect(copy.format).toBe("substack");
    // The whole point: the copy is open to edit and claims nothing about
    // having been published.
    expect(copy.status).toBe("in-progress");
    expect(copy.publish).toBeUndefined();
    expect(copy.editedAfterPublishAt).toBeUndefined();
    // And the original is untouched.
    expect(useContentStore.getState().pieces[sourceId].status).toBe("published");
  });

  it("duplicating a piece that is gone returns nothing rather than a stray piece", () => {
    const before = Object.keys(useContentStore.getState().pieces).length;
    expect(useContentStore.getState().duplicatePiece("no-such-piece")).toBe("");
    expect(Object.keys(useContentStore.getState().pieces).length).toBe(before);
  });
});

describe("content-store: creating and deleting a fragment", () => {
  beforeEach(resetStore);

  it("createIdeaWithFragment returns both ids and puts the fragment in the new idea", () => {
    const { ideaId, pieceId } = useContentStore.getState().createIdeaWithFragment({ title: "Agentic writing" });

    const idea = useContentStore.getState().ideas[ideaId];
    const piece = useContentStore.getState().pieces[pieceId];

    expect(idea.title).toBe("Agentic writing");
    expect(piece.ideaId).toBe(ideaId);
    expect(piece.title).toBe("Agentic writing");
  });

  it("createIdeaWithFragment opens a long-form fragment, ready to write in", () => {
    const { pieceId } = useContentStore.getState().createIdeaWithFragment();
    const piece = useContentStore.getState().pieces[pieceId];

    expect(isLongformFormat(piece.format)).toBe(true);
    expect(piece.body).toBe("");
    // Made by hand, so it is neither an unseen arrival nor an inbox item.
    expect(piece.seen).toBe(true);
    expect(piece.status).toBe("in-progress");
  });

  it("createIdeaWithFragment takes a starting format and body", () => {
    const { pieceId } = useContentStore.getState().createIdeaWithFragment({
      format: "tweet",
      body: "a hot take",
    });
    const piece = useContentStore.getState().pieces[pieceId];

    expect(piece.format).toBe("tweet");
    expect(piece.body).toBe("a hot take");
  });

  it("createIdeaWithFragment writes nothing before hydration", () => {
    useContentStore.setState({ hydrated: false });
    const { ideaId, pieceId } = useContentStore.getState().createIdeaWithFragment({ title: "Too early" });

    expect(ideaId).toBe("");
    expect(pieceId).toBe("");
    expect(Object.keys(useContentStore.getState().ideas)).toHaveLength(0);
    expect(Object.keys(useContentStore.getState().pieces)).toHaveLength(0);
  });

  it("deletePieceCascade tombstones the fragment and keeps its snips for the undo", () => {
    useDataStore.setState({ snippets: {}, hydrated: true });
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const pieceId = useContentStore.getState().createPiece({ ideaId, format: "essay", origin: "user", status: "inbox", });
    const mine = useDataStore.getState().addSnippet(pieceId, "cut from the draft");
    const theirs = useDataStore.getState().addSnippet(null, "cut from the idea", undefined, ideaId);

    useContentStore.getState().deletePieceCascade(pieceId);

    // A tombstone is reversible, so nothing reachable only through the
    // fragment may be destroyed alongside it. The snips are already hidden by
    // the fragment being hidden.
    expect(useContentStore.getState().pieces[pieceId].deletedAt).toBeDefined();
    expect(useDataStore.getState().snippets[mine]).toBeDefined();
    expect(useDataStore.getState().snippets[theirs]).toBeDefined();
  });

  it("deletePieceCascade hands back the next fragment in the same idea", () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const first = useContentStore.getState().createPiece({ ideaId, format: "essay", origin: "user", status: "inbox", });
    const second = useContentStore.getState().createPiece({ ideaId, format: "essay", origin: "user", status: "inbox", });
    const elsewhere = useContentStore.getState().createIdea({ title: "Elsewhere" });
    useContentStore.getState().createPiece({ ideaId: elsewhere, format: "essay", origin: "user", status: "inbox", });

    expect(useContentStore.getState().deletePieceCascade(first)).toBe(second);
  });

  it("deletePieceCascade returns null when that was the idea's last fragment", () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const only = useContentStore.getState().createPiece({ ideaId, format: "essay", origin: "user", status: "inbox", });

    expect(useContentStore.getState().deletePieceCascade(only)).toBeNull();
  });

  it("deletePieceCascade skips fragments already in the bin when picking a successor", () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const doomed = useContentStore.getState().createPiece({ ideaId, format: "essay", origin: "user", status: "inbox", });
    const alreadyGone = useContentStore.getState().createPiece({ ideaId, format: "essay", origin: "user", status: "inbox", });
    useContentStore.getState().rejectPiece(alreadyGone);

    expect(useContentStore.getState().deletePieceCascade(doomed)).toBeNull();
  });

  it("restorePieceCascade puts the fragment back with its text", () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const pieceId = useContentStore.getState().createPiece({
      ideaId, format: "essay", origin: "user", status: "inbox", body: "the words",
    });

    useContentStore.getState().deletePieceCascade(pieceId);
    useContentStore.getState().restorePieceCascade(pieceId);

    const piece = useContentStore.getState().pieces[pieceId];
    expect(piece.deletedAt).toBeUndefined();
    expect(piece.body).toBe("the words");
  });

  it("restorePieceCascade brings back the fragment and the snips cut from it", () => {
    useDataStore.setState({ snippets: {}, hydrated: true });
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const pieceId = useContentStore.getState().createPiece({
      ideaId, format: "essay", origin: "user", status: "inbox", body: "the words",
    });
    const snipId = useDataStore.getState().addSnippet(pieceId, "the words");

    useContentStore.getState().deletePieceCascade(pieceId);
    useContentStore.getState().restorePieceCascade(pieceId);

    expect(useContentStore.getState().pieces[pieceId].deletedAt).toBeUndefined();
    expect(useDataStore.getState().snippets[snipId]).toBeDefined();
  });
});

describe("content-store — archive", () => {
  beforeEach(resetStore);

  function makePiece(ideaId: string, body = "words"): string {
    return useContentStore.getState().createPiece({
      ideaId, format: "tweet", origin: "user", status: "in-progress", body,
    });
  }

  it("archiving an idea takes its sub-ideas and every piece under it", () => {
    const store = useContentStore.getState();
    const rootId = store.createIdea({ title: "Root" });
    const childId = store.createIdea({ title: "Child", parentId: rootId });
    const rootPiece = makePiece(rootId);
    const childPiece = makePiece(childId);

    const archive = useContentStore.getState().archiveIdeaCascade(rootId);

    const state = useContentStore.getState();
    expect(state.ideas[rootId].archivedAt).toBeDefined();
    expect(state.ideas[childId].archivedAt).toBeDefined();
    expect(state.pieces[rootPiece].archivedAt).toBeDefined();
    expect(state.pieces[childPiece].archivedAt).toBeDefined();
    expect(archive.ideaIds.sort()).toEqual([rootId, childId].sort());
    expect(archive.pieceIds.sort()).toEqual([rootPiece, childPiece].sort());
  });

  it("archiving keeps every word, unlike deleting", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    const pieceId = makePiece(ideaId, "the sentence I want back");

    useContentStore.getState().archiveIdeaCascade(ideaId);

    const piece = useContentStore.getState().pieces[pieceId];
    expect(piece.body).toBe("the sentence I want back");
    expect(piece.deletedAt).toBeUndefined();
  });

  it("restoring an archive lifts exactly what that archive stamped", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    const together = makePiece(ideaId, "went with the idea");
    const separately = makePiece(ideaId, "put away on its own");

    // Archived by hand first, so it is not part of the idea's cascade and
    // must still be archived after the idea comes back.
    useContentStore.getState().archivePiece(separately);
    const archive = useContentStore.getState().archiveIdeaCascade(ideaId);
    expect(archive.pieceIds).toEqual([together]);

    useContentStore.getState().restoreIdeaArchive(archive);

    const state = useContentStore.getState();
    expect(state.ideas[ideaId].archivedAt).toBeUndefined();
    expect(state.pieces[together].archivedAt).toBeUndefined();
    expect(state.pieces[separately].archivedAt).toBeDefined();
  });

  it("archivePiece and unarchivePiece round-trip one piece", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    const pieceId = makePiece(ideaId);

    useContentStore.getState().archivePiece(pieceId);
    expect(useContentStore.getState().pieces[pieceId].archivedAt).toBeDefined();

    useContentStore.getState().unarchivePiece(pieceId);
    expect(useContentStore.getState().pieces[pieceId].archivedAt).toBeUndefined();
  });

  it("pinPiece and unpinPiece round-trip one piece", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    const pieceId = makePiece(ideaId);

    useContentStore.getState().pinPiece(pieceId);
    expect(useContentStore.getState().pieces[pieceId].pinnedAt).toBeDefined();

    useContentStore.getState().unpinPiece(pieceId);
    expect(useContentStore.getState().pieces[pieceId].pinnedAt).toBeUndefined();
  });

  it("a deleted idea cannot be archived", () => {
    const store = useContentStore.getState();
    const ideaId = store.createIdea({ title: "Idea" });
    useContentStore.getState().deleteIdeaCascade(ideaId);

    const archive = useContentStore.getState().archiveIdeaCascade(ideaId);
    expect(archive).toEqual({ ideaIds: [], pieceIds: [] });
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
      .createPiece({ ideaId, format: "tweet", origin: "user", status: "inbox", body: "x" });
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
