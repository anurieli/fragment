import { describe, it, expect } from "vitest";
import { snippetHome, snipHomeKey, isSnippetVisible, visibleSnippets } from "@/lib/snip-scope";
import type { Snippet } from "@/lib/types";

function makeSnippet(over: Partial<Snippet> = {}): Snippet {
  return {
    id: "s1",
    noteId: null,
    content: "text",
    label: null,
    labelStatus: "idle",
    createdAt: 0,
    order: 0,
    ...over,
  };
}

describe("snippetHome", () => {
  it("a snip off a draft belongs to the note, even when tagged with an idea", () => {
    expect(snippetHome({ noteId: "note-1", ideaId: "idea-1" })).toBe("note:note-1");
  });

  it("a snip off a piece belongs to the idea", () => {
    expect(snippetHome({ noteId: null, ideaId: "idea-1" })).toBe("idea:idea-1");
  });

  it("has no home with neither", () => {
    expect(snippetHome({ noteId: null })).toBeNull();
    expect(snipHomeKey(null, undefined)).toBeNull();
  });
});

describe("isSnippetVisible", () => {
  it("shows the active note's snips", () => {
    expect(isSnippetVisible({ noteId: "note-1" }, "note-1", null)).toBe(true);
  });

  it("shows the open idea's snips even with no note open", () => {
    expect(isSnippetVisible({ noteId: null, ideaId: "idea-1" }, null, "idea-1")).toBe(true);
  });

  it("keeps a draft's snips on screen after crossing to that idea's pieces", () => {
    // Write -> Pieces clears nothing: the note stays active, and the snippet
    // carries the idea too.
    expect(isSnippetVisible({ noteId: "note-1", ideaId: "idea-1" }, null, "idea-1")).toBe(true);
  });

  it("hides another note's and another idea's snips", () => {
    expect(isSnippetVisible({ noteId: "note-2" }, "note-1", "idea-1")).toBe(false);
    expect(isSnippetVisible({ noteId: null, ideaId: "idea-2" }, "note-1", "idea-1")).toBe(false);
  });

  it("hides everything when nothing is open", () => {
    expect(isSnippetVisible({ noteId: "note-1", ideaId: "idea-1" }, null, null)).toBe(false);
  });
});

describe("visibleSnippets", () => {
  it("merges both homes, ordered, with createdAt breaking ties", () => {
    const all: Snippet[] = [
      makeSnippet({ id: "note-b", noteId: "note-1", order: 1, createdAt: 10 }),
      makeSnippet({ id: "idea-a", ideaId: "idea-1", order: 0, createdAt: 20 }),
      makeSnippet({ id: "note-a", noteId: "note-1", order: 0, createdAt: 5 }),
      makeSnippet({ id: "elsewhere", noteId: "note-9", order: 0, createdAt: 1 }),
    ];

    expect(visibleSnippets(all, "note-1", "idea-1").map((s) => s.id)).toEqual([
      "note-a",
      "idea-a",
      "note-b",
    ]);
  });

  it("accepts the store's map as well as an array", () => {
    const map = {
      a: makeSnippet({ id: "a", ideaId: "idea-1" }),
      b: makeSnippet({ id: "b", ideaId: "idea-2" }),
    };
    expect(visibleSnippets(map, null, "idea-1").map((s) => s.id)).toEqual(["a"]);
  });
});
