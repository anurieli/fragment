import { describe, it, expect } from "vitest";

import {
  effectiveResourcesForIdea,
  effectiveResourcesForPiece,
} from "@/stores/resources-selectors";
import { hierarchyRollup } from "@/stores/content-selectors";
import { importResourceLines, type AgentResourceFile } from "@/lib/agent-inbox/import";
import type { ContentPiece, Idea, Resource } from "@/lib/content-engine";

// ---------------------------------------------------------------------------
// Fixtures — a 3-level tree: root idea -> child idea -> pieces on each.
// ---------------------------------------------------------------------------

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

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: "res-1",
    ownerType: "idea",
    ownerId: "idea-1",
    kind: "link",
    url: "https://example.com/a",
    title: "A link",
    createdAt: 1000,
    ...overrides,
  };
}

const root = makeIdea({ id: "root", title: "Root idea", parentId: null });
const child = makeIdea({ id: "child", title: "Child idea", parentId: "root" });
const rootPiece = makePiece({ id: "root-piece", ideaId: "root" });
const childPiece = makePiece({ id: "child-piece", ideaId: "child" });

// ---------------------------------------------------------------------------
// effectiveResourcesForIdea
// ---------------------------------------------------------------------------

describe("effectiveResourcesForIdea", () => {
  it("a root idea sees only its own resources", () => {
    const ideas = [root, child];
    const resources = [
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
      makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" }),
    ];
    const result = effectiveResourcesForIdea("root", ideas, resources);
    expect(result.map((e) => e.resource.id)).toEqual(["r-root"]);
    expect(result[0].inheritedFrom).toBeUndefined();
  });

  it("a child idea sees its own resources plus its parent's, tagged inherited", () => {
    const ideas = [root, child];
    const resources = [
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
      makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" }),
    ];
    const result = effectiveResourcesForIdea("child", ideas, resources);
    const own = result.find((e) => e.resource.id === "r-child");
    const inherited = result.find((e) => e.resource.id === "r-root");

    expect(own).toBeDefined();
    expect(own?.inheritedFrom).toBeUndefined();
    expect(inherited).toBeDefined();
    expect(inherited?.inheritedFrom).toEqual({ type: "idea", id: "root", title: "Root idea" });
  });

  it("a tombstoned owning idea contributes nothing", () => {
    const deletedChild = { ...child, deletedAt: 999 };
    const resources = [makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" })];
    expect(effectiveResourcesForIdea("child", [root, deletedChild], resources)).toEqual([]);
  });

  it("a tombstoned parent idea contributes nothing, but the child's own resources still show", () => {
    const deletedRoot = { ...root, deletedAt: 999 };
    const resources = [
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
      makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" }),
    ];
    const result = effectiveResourcesForIdea("child", [deletedRoot, child], resources);
    expect(result.map((e) => e.resource.id)).toEqual(["r-child"]);
  });

  it("returns [] for an unknown idea id", () => {
    expect(effectiveResourcesForIdea("missing", [root], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// effectiveResourcesForPiece
// ---------------------------------------------------------------------------

describe("effectiveResourcesForPiece — 3-level composition", () => {
  it("a piece on the root idea sees its own + the root idea's resources", () => {
    const ideas = [root, child];
    const pieces = [rootPiece, childPiece];
    const resources = [
      makeResource({ id: "r-piece", ownerType: "piece", ownerId: "root-piece" }),
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
      makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" }),
    ];
    const result = effectiveResourcesForPiece("root-piece", pieces, ideas, resources);
    const byId = new Map(result.map((e) => [e.resource.id, e]));

    expect(byId.has("r-piece")).toBe(true);
    expect(byId.get("r-piece")?.inheritedFrom).toBeUndefined();
    expect(byId.has("r-root")).toBe(true);
    expect(byId.get("r-root")?.inheritedFrom).toEqual({ type: "idea", id: "root", title: "Root idea" });
    // The sibling child idea's resources are never visible from the root piece.
    expect(byId.has("r-child")).toBe(false);
  });

  it("a piece on the child idea sees its own + the child idea's + the root (grandparent) idea's resources", () => {
    const ideas = [root, child];
    const pieces = [rootPiece, childPiece];
    const resources = [
      makeResource({ id: "r-piece", ownerType: "piece", ownerId: "child-piece" }),
      makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" }),
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
    ];
    const result = effectiveResourcesForPiece("child-piece", pieces, ideas, resources);
    const byId = new Map(result.map((e) => [e.resource.id, e]));

    expect(byId.has("r-piece")).toBe(true);
    expect(byId.get("r-piece")?.inheritedFrom).toBeUndefined();

    expect(byId.has("r-child")).toBe(true);
    expect(byId.get("r-child")?.inheritedFrom).toEqual({ type: "idea", id: "child", title: "Child idea" });

    // Max depth 2: the root idea's resources are still visible (piece -> idea -> parent),
    // tagged with the root idea, not the immediate parent.
    expect(byId.has("r-root")).toBe(true);
    expect(byId.get("r-root")?.inheritedFrom).toEqual({ type: "idea", id: "root", title: "Root idea" });
  });

  it("a deleted (tombstoned) piece contributes nothing", () => {
    const deletedPiece = { ...rootPiece, deletedAt: 999 };
    const resources = [makeResource({ id: "r-piece", ownerType: "piece", ownerId: "root-piece" })];
    expect(effectiveResourcesForPiece("root-piece", [deletedPiece], [root], resources)).toEqual([]);
  });

  it("a deleted owning idea excludes inherited resources but keeps the piece's own", () => {
    const deletedRoot = { ...root, deletedAt: 999 };
    const resources = [
      makeResource({ id: "r-piece", ownerType: "piece", ownerId: "root-piece" }),
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
    ];
    const result = effectiveResourcesForPiece("root-piece", [rootPiece], [deletedRoot], resources);
    expect(result.map((e) => e.resource.id)).toEqual(["r-piece"]);
  });

  it("returns [] for an unknown piece id", () => {
    expect(effectiveResourcesForPiece("missing", [rootPiece], [root], [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Roll-up correctness with hierarchyRollup interplay
// ---------------------------------------------------------------------------

describe("hierarchyRollup interplay", () => {
  it("every piece hierarchyRollup surfaces for a root idea resolves consistent effective resources", () => {
    const ideas = [root, child];
    const pieces = [rootPiece, childPiece];
    const resources = [
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
      makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" }),
      makeResource({ id: "r-root-piece", ownerType: "piece", ownerId: "root-piece" }),
      makeResource({ id: "r-child-piece", ownerType: "piece", ownerId: "child-piece" }),
    ];

    const rolledUp = hierarchyRollup("root", ideas, pieces);
    expect(rolledUp.map((p) => p.id).sort()).toEqual(["child-piece", "root-piece"]);

    const effectivePerPiece = new Map(
      rolledUp.map((p) => [p.id, effectiveResourcesForPiece(p.id, pieces, ideas, resources).map((e) => e.resource.id).sort()]),
    );

    expect(effectivePerPiece.get("root-piece")).toEqual(["r-root", "r-root-piece"]);
    expect(effectivePerPiece.get("child-piece")).toEqual(["r-child", "r-child-piece", "r-root"]);
  });

  it("a rolled-up child idea's own resource rail matches effectiveResourcesForIdea, independent of piece ownership", () => {
    const ideas = [root, child];
    const pieces = [rootPiece, childPiece];
    const resources = [
      makeResource({ id: "r-root", ownerType: "idea", ownerId: "root" }),
      makeResource({ id: "r-child", ownerType: "idea", ownerId: "child" }),
    ];

    const rolledUp = hierarchyRollup("root", ideas, pieces);
    const ownerIds = new Set(rolledUp.map((p) => p.ideaId));
    expect(ownerIds).toEqual(new Set(["root", "child"]));

    for (const ideaId of ownerIds) {
      const viaIdea = effectiveResourcesForIdea(ideaId, ideas, resources).map((e) => e.resource.id).sort();
      if (ideaId === "root") expect(viaIdea).toEqual(["r-root"]);
      if (ideaId === "child") expect(viaIdea).toEqual(["r-child", "r-root"].sort());
    }
  });
});

// ---------------------------------------------------------------------------
// resources.jsonl import idempotency
// ---------------------------------------------------------------------------

function makeResourceFile(lines: object[], relPath = "idea-1/resources.jsonl", mtime = 1000): AgentResourceFile {
  return {
    ideaId: "idea-1",
    relPath,
    content: lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    mtime,
  };
}

describe("importResourceLines", () => {
  it("parses valid lines into Resource rows and acks the file", () => {
    const file = makeResourceFile([
      { id: "res-a", ownerType: "idea", ownerId: "idea-1", kind: "link", title: "A", url: "https://a.com", createdAt: 5000 },
      { id: "res-b", ownerType: "piece", ownerId: "piece-1", kind: "note", title: "B", note: "context" },
    ]);
    const result = importResourceLines([file], { existingResourceIds: new Set(), now: 9000, generateId: () => "generated" });

    expect(result.resourcesToUpsert).toHaveLength(2);
    expect(result.resourcesToUpsert[0]).toMatchObject({ id: "res-a", title: "A", createdAt: 5000 });
    // A line with no id gets one generated; a line with no createdAt gets `now`.
    expect(result.resourcesToUpsert[1]).toMatchObject({ id: "res-b", title: "B", createdAt: 9000 });
    expect(result.acks).toEqual(["idea-1/resources.jsonl"]);
  });

  it("fills in a missing id from generateId when the line omits it", () => {
    const file = makeResourceFile([{ ownerType: "idea", ownerId: "idea-1", kind: "link", title: "No id", url: "https://x.com" }]);
    const result = importResourceLines([file], { existingResourceIds: new Set(), now: 1234, generateId: () => "minted-id" });
    expect(result.resourcesToUpsert).toEqual([
      { id: "minted-id", ownerType: "idea", ownerId: "idea-1", kind: "link", url: "https://x.com", title: "No id", note: undefined, createdAt: 1234 },
    ]);
  });

  it("is idempotent: re-importing the same file against the resulting store state produces no duplicates", () => {
    const file = makeResourceFile([
      { id: "res-a", ownerType: "idea", ownerId: "idea-1", kind: "link", title: "A", url: "https://a.com", createdAt: 5000 },
    ]);

    const first = importResourceLines([file], { existingResourceIds: new Set(), now: 9000, generateId: () => "unused" });
    expect(first.resourcesToUpsert).toHaveLength(1);

    // Fold the first import's output back into "store state" the way the real
    // hook does after persisting it, then re-import the identical file.
    const existingIds = new Set(first.resourcesToUpsert.map((r) => r.id));
    const second = importResourceLines([file], { existingResourceIds: existingIds, now: 9000, generateId: () => "unused" });

    expect(second.resourcesToUpsert).toEqual([]);
    expect(second.acks).toEqual(["idea-1/resources.jsonl"]);
  });

  it("dedupes within a single batch, keeping only the first occurrence of a repeated id", () => {
    const file = makeResourceFile([
      { id: "res-dup", ownerType: "idea", ownerId: "idea-1", kind: "link", title: "First", url: "https://a.com" },
      { id: "res-dup", ownerType: "idea", ownerId: "idea-1", kind: "link", title: "Second (stale re-append)", url: "https://a.com" },
    ]);
    const result = importResourceLines([file], { existingResourceIds: new Set(), now: 1000, generateId: () => "unused" });
    expect(result.resourcesToUpsert).toHaveLength(1);
    expect(result.resourcesToUpsert[0].title).toBe("First");
  });

  it("skips a malformed line without failing the rest of the file, and still acks it", () => {
    const file: AgentResourceFile = {
      ideaId: "idea-1",
      relPath: "idea-1/resources.jsonl",
      content: 'not json\n{"id":"res-ok","ownerType":"idea","ownerId":"idea-1","kind":"link","title":"OK","url":"https://ok.com"}\n',
      mtime: 1000,
    };
    const result = importResourceLines([file], { existingResourceIds: new Set(), now: 1000, generateId: () => "unused" });
    expect(result.resourcesToUpsert.map((r) => r.id)).toEqual(["res-ok"]);
    expect(result.skips.some((s) => s.reason === "parse-error")).toBe(true);
    expect(result.acks).toEqual(["idea-1/resources.jsonl"]);
  });

  it("skips a line failing schema validation (e.g. missing required title)", () => {
    const file: AgentResourceFile = {
      ideaId: "idea-1",
      relPath: "idea-1/resources.jsonl",
      content: '{"ownerType":"idea","ownerId":"idea-1","kind":"link","url":"https://x.com"}\n',
      mtime: 1000,
    };
    const result = importResourceLines([file], { existingResourceIds: new Set(), now: 1000, generateId: () => "unused" });
    expect(result.resourcesToUpsert).toEqual([]);
    expect(result.skips).toHaveLength(1);
    expect(result.skips[0].reason).toBe("parse-error");
  });

  it("ignores blank lines", () => {
    const file: AgentResourceFile = {
      ideaId: "idea-1",
      relPath: "idea-1/resources.jsonl",
      content: '\n\n{"id":"res-1","ownerType":"idea","ownerId":"idea-1","kind":"link","title":"A","url":"https://a.com"}\n\n',
      mtime: 1000,
    };
    const result = importResourceLines([file], { existingResourceIds: new Set(), now: 1000, generateId: () => "unused" });
    expect(result.resourcesToUpsert).toHaveLength(1);
    expect(result.skips).toEqual([]);
  });
});
