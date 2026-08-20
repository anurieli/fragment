import { beforeEach, describe, expect, it } from "vitest";

import {
  consumeEmptyCreation,
  isEmptyIdea,
  isEmptyNote,
  isEmptyPiece,
  resetEmptyCreations,
  trackEmptyCreation,
} from "@/lib/empty-creations";
import type { ContentPiece, Idea } from "@/lib/content-engine";
import type { Note } from "@/lib/types";

const now = 1_000;

function note(partial: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    title: "",
    subtitle: "",
    content: "",
    goal: "",
    audience: "",
    tone: "",
    remember: "",
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

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
    status: "inbox",
    origin: "user",
    body: "",
    seen: false,
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
    trackEmptyCreation("note", "note-1");

    expect(consumeEmptyCreation("note", "note-1")).toBe(true);
    expect(consumeEmptyCreation("note", "note-1")).toBe(false);
  });

  it("treats a note as empty only when every user-authored field is blank", () => {
    expect(isEmptyNote(note())).toBe(true);
    expect(isEmptyNote(note({ content: "A thought" }))).toBe(false);
    expect(isEmptyNote(note({ goal: "Explain it" }))).toBe(false);
    expect(isEmptyNote(note({ voiceId: "voice-1" }))).toBe(false);
  });

  it("treats only an unused untitled idea as empty", () => {
    expect(isEmptyIdea(idea(), { hasChildren: false, hasPieces: false, hasResources: false })).toBe(true);
    expect(isEmptyIdea(idea({ title: "A real idea" }), { hasChildren: false, hasPieces: false, hasResources: false })).toBe(false);
    expect(isEmptyIdea(idea(), { hasChildren: false, hasPieces: true, hasResources: false })).toBe(false);
  });

  it("treats only an untouched blank user piece as empty", () => {
    expect(isEmptyPiece(piece(), { hasResources: false })).toBe(true);
    expect(isEmptyPiece(piece({ body: "A thought" }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece({ priority: 2 }), { hasResources: false })).toBe(false);
    expect(isEmptyPiece(piece({ origin: "agent" }), { hasResources: false })).toBe(false);
  });
});
