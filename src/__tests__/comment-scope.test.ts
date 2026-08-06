import { describe, it, expect } from "vitest";
import { commentHome, visibleComments } from "@/lib/comment-scope";
import type { Comment } from "@/lib/types";

function makeComment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    noteId: null,
    ideaId: null,
    body: "text",
    createdAt: 0,
    updatedAt: 0,
    promotedIdeaId: null,
    ...over,
  };
}

describe("commentHome", () => {
  it("a standalone draft is the comment's home", () => {
    expect(commentHome("note-1", null, undefined)).toEqual({ noteId: "note-1", ideaId: null });
  });

  it("an idea's Write space attaches to the open draft, not the idea", () => {
    expect(commentHome("note-1", "idea-1", "write")).toEqual({ noteId: "note-1", ideaId: null });
  });

  it("an idea's Pieces space has no note on screen, so it goes to the idea", () => {
    expect(commentHome("note-1", "idea-1", "pieces")).toEqual({ noteId: null, ideaId: "idea-1" });
  });

  it("an idea with no draft yet falls back to the idea itself", () => {
    expect(commentHome(null, "idea-1", "write")).toEqual({ noteId: null, ideaId: "idea-1" });
  });

  it("has no home with nothing open", () => {
    expect(commentHome(null, null, undefined)).toBeNull();
  });
});

describe("visibleComments", () => {
  it("returns only the current home's comments, oldest first", () => {
    const all: Comment[] = [
      makeComment({ id: "b", noteId: "note-1", createdAt: 20 }),
      makeComment({ id: "a", noteId: "note-1", createdAt: 10 }),
      makeComment({ id: "elsewhere", noteId: "note-2", createdAt: 5 }),
      makeComment({ id: "idea-comment", ideaId: "idea-1", createdAt: 1 }),
    ];

    const home = { noteId: "note-1", ideaId: null };
    expect(visibleComments(all, home).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("returns nothing when there is no home", () => {
    const all: Comment[] = [makeComment({ noteId: "note-1" })];
    expect(visibleComments(all, null)).toEqual([]);
  });

  it("accepts the store's map as well as an array", () => {
    const map = {
      a: makeComment({ id: "a", ideaId: "idea-1", createdAt: 1 }),
      b: makeComment({ id: "b", ideaId: "idea-2", createdAt: 2 }),
    };
    expect(visibleComments(map, { noteId: null, ideaId: "idea-1" }).map((c) => c.id)).toEqual(["a"]);
  });
});
