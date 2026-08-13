import { describe, it, expect } from "vitest";

import {
  draftsForIdea,
  hierarchyRollup,
  pieceAge,
  pieceCountsForIdea,
  pinnedFirst,
  publishQueue,
  publishRollupForIdea,
  shortformOnly,
  staleness,
  workingOn,
} from "@/stores/content-selectors";
import type { ContentPiece, Idea, Priority } from "@/lib/content-engine";

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: "idea-1",
    title: "Idea",
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function makePiece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "piece-1",
    ideaId: "idea-1",
    format: "tweet",
    status: "inbox",
    origin: "user",
    body: "text",
    seen: false,
    priority: 0,
    order: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

describe("publishQueue", () => {
  it("keeps only status=ready, non-deleted pieces", () => {
    const pieces = [
      makePiece({ id: "a", status: "ready" }),
      makePiece({ id: "b", status: "inbox" }),
      makePiece({ id: "c", status: "ready", deletedAt: 5000 }),
    ];
    const queue = publishQueue(pieces);
    expect(queue.map((p) => p.id)).toEqual(["a"]);
  });

  it("sorts priority-first: 1 urgent .. 4 low, then 0 none last", () => {
    const pieces = [
      makePiece({ id: "none", status: "ready", priority: 0, createdAt: 1 }),
      makePiece({ id: "low", status: "ready", priority: 4, createdAt: 1 }),
      makePiece({ id: "urgent", status: "ready", priority: 1, createdAt: 1 }),
      makePiece({ id: "medium", status: "ready", priority: 3, createdAt: 1 }),
      makePiece({ id: "high", status: "ready", priority: 2, createdAt: 1 }),
    ];
    const queue = publishQueue(pieces);
    expect(queue.map((p) => p.id)).toEqual(["urgent", "high", "medium", "low", "none"]);
  });

  it("breaks priority ties by oldest createdAt first", () => {
    const pieces = [
      makePiece({ id: "newer", status: "ready", priority: 1, createdAt: 2000 }),
      makePiece({ id: "older", status: "ready", priority: 1, createdAt: 1000 }),
    ];
    const queue = publishQueue(pieces);
    expect(queue.map((p) => p.id)).toEqual(["older", "newer"]);
  });
});

describe("pieceAge / staleness", () => {
  it("pieceAge is now - createdAt", () => {
    expect(pieceAge(makePiece({ createdAt: 1000 }), 5000)).toBe(4000);
  });

  it("staleness is now - updatedAt", () => {
    expect(staleness(makePiece({ updatedAt: 2000 }), 5000)).toBe(3000);
  });

  it("both floor at zero for a now before the timestamp", () => {
    expect(pieceAge(makePiece({ createdAt: 5000 }), 1000)).toBe(0);
    expect(staleness(makePiece({ updatedAt: 5000 }), 1000)).toBe(0);
  });
});

describe("workingOn", () => {
  it("returns pieces edited within the window, most recent first", () => {
    const pieces = [
      makePiece({ id: "fresh", updatedAt: 9000 }),
      makePiece({ id: "stale", updatedAt: 1000 }),
      makePiece({ id: "mid", updatedAt: 8000 }),
    ];
    const result = workingOn(pieces, 10_000, 5_000);
    expect(result.map((p) => p.id)).toEqual(["fresh", "mid"]);
  });

  it("excludes deleted pieces", () => {
    const pieces = [makePiece({ id: "a", updatedAt: 9000, deletedAt: 9500 })];
    expect(workingOn(pieces, 10_000, 5_000)).toHaveLength(0);
  });
});

describe("pinnedFirst", () => {
  it("orders pinned ideas before unpinned ideas", () => {
    const ideas = [
      makeIdea({ id: "unpinned", pinnedAt: undefined }),
      makeIdea({ id: "pinned", pinnedAt: 5000 }),
    ];
    expect(pinnedFirst(ideas).map((i) => i.id)).toEqual(["pinned", "unpinned"]);
  });

  it("among pinned ideas, most-recently-pinned first", () => {
    const ideas = [
      makeIdea({ id: "old-pin", pinnedAt: 1000 }),
      makeIdea({ id: "new-pin", pinnedAt: 9000 }),
    ];
    expect(pinnedFirst(ideas).map((i) => i.id)).toEqual(["new-pin", "old-pin"]);
  });

  it("among unpinned ideas, sorts by priority then most-recently-updated", () => {
    const ideas = [
      makeIdea({ id: "none", priority: 0 as Priority, updatedAt: 9000 }),
      makeIdea({ id: "urgent-old", priority: 1 as Priority, updatedAt: 1000 }),
      makeIdea({ id: "urgent-new", priority: 1 as Priority, updatedAt: 5000 }),
    ];
    expect(pinnedFirst(ideas).map((i) => i.id)).toEqual([
      "urgent-new",
      "urgent-old",
      "none",
    ]);
  });

  it("excludes deleted ideas", () => {
    const ideas = [makeIdea({ id: "gone", deletedAt: 1234 })];
    expect(pinnedFirst(ideas)).toHaveLength(0);
  });
});

describe("hierarchyRollup", () => {
  it("includes the idea's own pieces", () => {
    const ideas = [makeIdea({ id: "root" })];
    const pieces = [makePiece({ id: "p1", ideaId: "root" })];
    expect(hierarchyRollup("root", ideas, pieces).map((p) => p.id)).toEqual(["p1"]);
  });

  it("includes a direct child idea's pieces (depth 2)", () => {
    const ideas = [
      makeIdea({ id: "root" }),
      makeIdea({ id: "child", parentId: "root" }),
    ];
    const pieces = [
      makePiece({ id: "root-piece", ideaId: "root" }),
      makePiece({ id: "child-piece", ideaId: "child" }),
    ];
    const result = hierarchyRollup("root", ideas, pieces).map((p) => p.id);
    expect(result.sort()).toEqual(["child-piece", "root-piece"]);
  });

  it("does not include pieces from unrelated ideas", () => {
    const ideas = [makeIdea({ id: "root" }), makeIdea({ id: "other" })];
    const pieces = [makePiece({ id: "other-piece", ideaId: "other" })];
    expect(hierarchyRollup("root", ideas, pieces)).toHaveLength(0);
  });

  it("excludes deleted pieces and pieces of deleted child ideas", () => {
    const ideas = [
      makeIdea({ id: "root" }),
      makeIdea({ id: "child", parentId: "root", deletedAt: 999 }),
    ];
    const pieces = [
      makePiece({ id: "root-piece", ideaId: "root", deletedAt: 999 }),
      makePiece({ id: "child-piece", ideaId: "child" }),
    ];
    expect(hierarchyRollup("root", ideas, pieces)).toHaveLength(0);
  });
});

describe("shortformOnly", () => {
  it("drops long-form fragments, which live in the Write space", () => {
    const pieces = [
      makePiece({ id: "short", format: "tweet" }),
      makePiece({ id: "long", format: "essay" }),
    ];
    expect(shortformOnly(pieces).map((p) => p.id)).toEqual(["short"]);
  });

  it("keeps a fragment whose text is still empty", () => {
    const pieces = [makePiece({ id: "blank", format: "tweet", body: "" })];
    expect(shortformOnly(pieces).map((p) => p.id)).toEqual(["blank"]);
  });
});

describe("draftsForIdea", () => {
  it("returns only this idea's live long-form fragments, oldest first", () => {
    const pieces = [
      makePiece({ id: "b", ideaId: "root", format: "essay", createdAt: 2000 }),
      makePiece({ id: "a", ideaId: "root", format: "substack", createdAt: 1000 }),
      makePiece({ id: "short", ideaId: "root", format: "tweet" }),
      makePiece({ id: "other", ideaId: "elsewhere", format: "essay" }),
      makePiece({ id: "gone", ideaId: "root", format: "essay", deletedAt: 5 }),
    ];
    expect(draftsForIdea("root", pieces).map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("pieceCountsForIdea", () => {
  it("counts live pieces per status for the given idea only", () => {
    const pieces = [
      makePiece({ id: "a", ideaId: "root", status: "inbox" }),
      makePiece({ id: "b", ideaId: "root", status: "inbox" }),
      makePiece({ id: "c", ideaId: "root", status: "ready" }),
      makePiece({ id: "d", ideaId: "other", status: "inbox" }),
      makePiece({ id: "e", ideaId: "root", status: "inbox", deletedAt: 1 }),
    ];
    expect(pieceCountsForIdea("root", pieces)).toEqual({
      inbox: 2,
      "in-progress": 0,
      ready: 1,
      published: 0,
    });
  });
});

describe("publishRollupForIdea", () => {
  function published(overrides: Partial<ContentPiece> = {}, publishedAt = 5000): ContentPiece {
    return makePiece({
      status: "published",
      publish: { platform: "substack", method: "manual", publishedAt, verified: true },
      ...overrides,
    });
  }

  it("reports nothing shipped when nothing is published", () => {
    const pieces = [makePiece({ id: "a", status: "ready" }), makePiece({ id: "b", status: "inbox" })];
    expect(publishRollupForIdea("idea-1", pieces)).toEqual({ count: 0, latestAt: null });
  });

  it("counts published pieces for the given idea only", () => {
    const pieces = [
      published({ id: "a", ideaId: "root" }),
      published({ id: "b", ideaId: "root" }),
      published({ id: "c", ideaId: "other" }),
      makePiece({ id: "d", ideaId: "root", status: "ready" }),
    ];
    expect(publishRollupForIdea("root", pieces).count).toBe(2);
  });

  // The whole point of the rollup: a long-form draft published to Substack is
  // the case the sidebar's short-form-only counts could never see.
  it("counts published long-form drafts, not just short-form pieces", () => {
    const pieces = [published({ id: "draft", ideaId: "root", format: "substack" })];
    expect(publishRollupForIdea("root", pieces).count).toBe(1);
  });

  it("takes the most recent publishedAt as latestAt", () => {
    const pieces = [
      published({ id: "old", ideaId: "root" }, 1000),
      published({ id: "new", ideaId: "root" }, 9000),
      published({ id: "mid", ideaId: "root" }, 4000),
    ];
    expect(publishRollupForIdea("root", pieces).latestAt).toBe(9000);
  });

  it("excludes deleted and archived pieces", () => {
    const pieces = [
      published({ id: "gone", ideaId: "root", deletedAt: 1 }),
      published({ id: "put-away", ideaId: "root", archivedAt: 1 }),
    ];
    expect(publishRollupForIdea("root", pieces)).toEqual({ count: 0, latestAt: null });
  });

  // status "published" with no publish record cannot reach the store
  // (assertPublishGuard rejects it), but the rollup should not invent a date if
  // it ever sees one.
  it("counts a published piece with no record but leaves latestAt null", () => {
    const pieces = [makePiece({ id: "a", ideaId: "root", status: "published" })];
    expect(publishRollupForIdea("root", pieces)).toEqual({ count: 1, latestAt: null });
  });
});
