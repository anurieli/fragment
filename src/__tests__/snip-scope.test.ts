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
  it("a snip cut out of a fragment belongs to the fragment, even when tagged with an idea", () => {
    expect(snippetHome({ pieceId: "piece-1", ideaId: "idea-1" })).toBe("piece:piece-1");
  });

  it("a snip cut with no fragment open belongs to the idea", () => {
    expect(snippetHome({ ideaId: "idea-1" })).toBe("idea:idea-1");
  });

  it("has no home with neither", () => {
    expect(snippetHome({})).toBeNull();
    expect(snipHomeKey(null, undefined)).toBeNull();
  });
});

describe("isSnippetVisible", () => {
  it("shows the open fragment's snips", () => {
    expect(isSnippetVisible({ pieceId: "piece-1" }, "piece-1", null)).toBe(true);
  });

  it("shows the open idea's snips even with no fragment open", () => {
    expect(isSnippetVisible({ ideaId: "idea-1" }, null, "idea-1")).toBe(true);
  });

  it("keeps a draft's snips on screen after crossing to that idea's pieces", () => {
    // Write -> Pieces clears nothing: the fragment stays active, and the
    // snippet carries the idea too.
    expect(isSnippetVisible({ pieceId: "piece-1", ideaId: "idea-1" }, null, "idea-1")).toBe(true);
  });

  it("hides another fragment's and another idea's snips", () => {
    expect(isSnippetVisible({ pieceId: "piece-2" }, "piece-1", "idea-1")).toBe(false);
    expect(isSnippetVisible({ ideaId: "idea-2" }, "piece-1", "idea-1")).toBe(false);
  });

  it("hides everything when nothing is open", () => {
    expect(isSnippetVisible({ pieceId: "piece-1", ideaId: "idea-1" }, null, null)).toBe(false);
  });
});

describe("visibleSnippets", () => {
  it("merges both homes, ordered, with createdAt breaking ties", () => {
    const all: Snippet[] = [
      makeSnippet({ id: "piece-b", pieceId: "piece-1", order: 1, createdAt: 10 }),
      makeSnippet({ id: "idea-a", ideaId: "idea-1", order: 0, createdAt: 20 }),
      makeSnippet({ id: "piece-a", pieceId: "piece-1", order: 0, createdAt: 5 }),
      makeSnippet({ id: "elsewhere", pieceId: "piece-9", order: 0, createdAt: 1 }),
    ];

    expect(visibleSnippets(all, "piece-1", "idea-1").map((s) => s.id)).toEqual([
      "piece-a",
      "idea-a",
      "piece-b",
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
