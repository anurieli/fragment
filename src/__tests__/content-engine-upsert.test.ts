import { describe, it, expect } from "vitest";

import {
  buildIdeaFromHandoff,
  buildResources,
  handoffToPiece,
  matchIdea,
  normalizeTitle,
  resolvePieceUpsert,
} from "@/lib/content-engine";
import type { Idea, PieceHandoff } from "@/lib/content-engine";

const ctx = { now: 1000, generateId: () => "generated" };

function makeHandoff(overrides: Partial<PieceHandoff> = {}): PieceHandoff {
  return {
    fragment: 1,
    ideaTitle: "The Idea",
    format: "linkedin",
    status: "inbox",
    origin: "agent",
    body: "content",
    priority: 0,
    resources: [],
    ...overrides,
  };
}

function makeIdea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: "i1",
    title: "The Idea",
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("content-engine — idea matching", () => {
  it("matches by id when ideaId is present", () => {
    const ideas = [makeIdea(), makeIdea({ id: "i2", title: "Other" })];
    expect(matchIdea(makeHandoff({ ideaId: "i2" }), ideas)?.id).toBe("i2");
  });

  it("matches by normalized title (case and whitespace insensitive)", () => {
    const ideas = [makeIdea({ title: "The  Big   Idea" })];
    expect(matchIdea(makeHandoff({ ideaTitle: "the big idea" }), ideas)?.id).toBe("i1");
    expect(normalizeTitle("  The  Big   Idea ")).toBe("the big idea");
  });

  it("never matches deleted ideas", () => {
    const ideas = [makeIdea({ deletedAt: 50 })];
    expect(matchIdea(makeHandoff(), ideas)).toBeUndefined();
    expect(matchIdea(makeHandoff({ ideaId: "i1" }), ideas)).toBeUndefined();
  });

  it("creates a root idea from the handoff", () => {
    const idea = buildIdeaFromHandoff(
      makeHandoff({ ideaTitle: "  Fresh Idea ", ideaSummary: "sum" }),
      ctx,
    );
    expect(idea).toEqual({
      id: "generated",
      title: "Fresh Idea",
      summary: "sum",
      parentId: null,
      priority: 0,
      origin: "agent",
      createdAt: 1000,
      updatedAt: 1000,
    });
  });

  it("refuses to invent an idea for an unmatched explicit ideaId", () => {
    expect(() =>
      buildIdeaFromHandoff(makeHandoff({ ideaId: "ghost", ideaTitle: undefined }), ctx),
    ).toThrow(/does not exist/);
  });
});

describe("content-engine — handoff to piece", () => {
  it("fills defaults: generated id, unseen, createdAt=now, updatedAt=createdAt", () => {
    const piece = handoffToPiece(makeHandoff(), { ...ctx, ideaId: "i1", order: 3 });
    expect(piece.id).toBe("generated");
    expect(piece.ideaId).toBe("i1");
    expect(piece.seen).toBe(false);
    expect(piece.order).toBe(3);
    expect(piece.createdAt).toBe(1000);
    expect(piece.updatedAt).toBe(1000);
    expect(piece.body).toBe("content");
  });

  it("keeps agent-provided timestamps as the canonical age", () => {
    const piece = handoffToPiece(makeHandoff({ createdAt: 500 }), {
      ...ctx,
      ideaId: "i1",
      order: 0,
    });
    expect(piece.createdAt).toBe(500);
    expect(piece.updatedAt).toBe(500);
    expect(piece.agentMeta?.pushedAt).toBe(1000);
  });

  it("attaches agentMeta only for agent-origin pieces", () => {
    const agentPiece = handoffToPiece(
      makeHandoff({ agent: "claude-code", model: "m", supersedes: "pc_old" }),
      { ...ctx, ideaId: "i1", order: 0 },
    );
    expect(agentPiece.agentMeta).toEqual({
      agent: "claude-code",
      model: "m",
      pushedAt: 1000,
      supersedes: "pc_old",
    });

    const userPiece = handoffToPiece(makeHandoff({ origin: "user" }), {
      ...ctx,
      ideaId: "i1",
      order: 0,
    });
    expect(userPiece.agentMeta).toBeUndefined();
  });

  it("builds resources owned by the piece", () => {
    const resources = buildResources(
      makeHandoff({ resources: [{ kind: "link", url: "https://x.co", title: "Ref" }] }),
      { type: "piece", id: "p1" },
      ctx,
    );
    expect(resources).toEqual([
      {
        id: "generated",
        ownerType: "piece",
        ownerId: "p1",
        kind: "link",
        url: "https://x.co",
        title: "Ref",
        note: undefined,
        createdAt: 1000,
      },
    ]);
  });
});

describe("content-engine — upsert resolution", () => {
  it("inserts when no existing piece", () => {
    expect(resolvePieceUpsert({ updatedAt: 10 }, undefined)).toEqual({ action: "insert" });
  });

  it("updates when the incoming piece is newer", () => {
    expect(resolvePieceUpsert({ updatedAt: 20 }, { updatedAt: 10 })).toEqual({
      action: "update",
    });
  });

  it("never overwrites a newer local piece", () => {
    expect(resolvePieceUpsert({ updatedAt: 10 }, { updatedAt: 20 })).toEqual({
      action: "skip",
      reason: "local-newer",
    });
  });

  it("treats equal timestamps as an idempotent re-import", () => {
    expect(resolvePieceUpsert({ updatedAt: 10 }, { updatedAt: 10 })).toEqual({
      action: "skip",
      reason: "unchanged",
    });
  });

  it("never resurrects a locally deleted piece", () => {
    expect(resolvePieceUpsert({ updatedAt: 99 }, { updatedAt: 1, deletedAt: 5 })).toEqual({
      action: "skip",
      reason: "local-deleted",
    });
  });
});
