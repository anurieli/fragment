import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeEmptyCreation,
  isEmptyIdea,
  isEmptyPiece,
  resetEmptyCreations,
  trackEmptyCreation,
} from "@/lib/empty-creations";
import type { ContentPiece, Idea } from "@/lib/content-engine";

const now = 1_000;

function idea(partial: Partial<Idea> = {}): Idea {
  return {
    id: "idea-1",
    title: "Untitled idea",
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

function piece(partial: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "piece-1",
    ideaId: "idea-1",
    format: "other",
    status: "in-progress",
    origin: "user",
    body: "",
    seen: true,
    priority: 0,
    order: 0,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("empty creation cleanup", () => {
  beforeEach(resetEmptyCreations);

  it("tracks a new entity until navigation consumes it exactly once", () => {
    trackEmptyCreation("piece", "piece-1");

    expect(consumeEmptyCreation("piece", "piece-1")).toBe(true);
    expect(consumeEmptyCreation("piece", "piece-1")).toBe(false);
  });

  it("treats only an unused untitled idea as empty", () => {
    const unused = { hasChildren: false, hasPieces: false, hasResources: false };
    expect(isEmptyIdea(idea(), unused)).toBe(true);
    expect(isEmptyIdea(idea({ title: "A real idea" }), unused)).toBe(false);
    expect(isEmptyIdea(idea({ goal: "Explore this" }), unused)).toBe(false);
    expect(isEmptyIdea(idea(), { ...unused, hasPieces: true })).toBe(false);
  });

  it("treats untouched long-form and short-form user pieces as empty", () => {
    expect(isEmptyPiece(piece(), { hasResources: false })).toBe(true);
    expect(isEmptyPiece(piece({ format: "essay" }), { hasResources: false })).toBe(true);
  });

  it("keeps a piece after any meaningful content or metadata is added", () => {
    expect(isEmptyPiece(piece({ body: "A thought" }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece({ goal: "Explain it" }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece({ priority: 2 }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece({ status: "ready" }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece({ voiceId: null }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece({ origin: "agent" }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece(), { hasResources: true })).toBe(false);
  });
});
