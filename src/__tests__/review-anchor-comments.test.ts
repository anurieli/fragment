import { describe, it, expect } from "vitest";
import { anchorComments, locateAnchor } from "@/lib/review";
import type { ReviewComment } from "@/lib/types";

function comment(partial: Partial<ReviewComment>): ReviewComment {
  return { id: "c1", anchorText: "", prefix: "", suffix: "", body: "note", ...partial };
}

describe("anchorComments", () => {
  it("anchors an exact, unique match", () => {
    const doc = "The quick brown fox jumps over the lazy dog.";
    const c = comment({ anchorText: "brown fox", prefix: "", suffix: "" });
    const { anchored, noteLevel } = anchorComments(doc, [c]);
    expect(noteLevel).toHaveLength(0);
    expect(anchored).toHaveLength(1);
    expect(anchored[0].start).toBe(doc.indexOf("brown fox"));
    expect(anchored[0].end).toBe(doc.indexOf("brown fox") + "brown fox".length);
  });

  it("disambiguates duplicate anchor text using prefix/suffix", () => {
    const doc = "First the cat sat on the mat. Later the cat sat on the rug.";
    const first = comment({
      id: "first",
      anchorText: "the cat sat",
      prefix: "First ",
      suffix: " on the mat",
    });
    const second = comment({
      id: "second",
      anchorText: "the cat sat",
      prefix: "Later ",
      suffix: " on the rug",
    });
    const { anchored, noteLevel } = anchorComments(doc, [first, second]);
    expect(noteLevel).toHaveLength(0);
    expect(anchored).toHaveLength(2);

    const firstResult = anchored.find((a) => a.comment.id === "first")!;
    const secondResult = anchored.find((a) => a.comment.id === "second")!;
    expect(firstResult.start).toBe(doc.indexOf("First the cat sat") + "First ".length);
    expect(secondResult.start).toBe(doc.indexOf("Later the cat sat") + "Later ".length);
    expect(firstResult.start).not.toBe(secondResult.start);
  });

  it("degrades to note-level when anchorText isn't found at all", () => {
    const doc = "Nothing matches here.";
    const c = comment({ anchorText: "missing phrase", prefix: "", suffix: "" });
    const { anchored, noteLevel } = anchorComments(doc, [c]);
    expect(anchored).toHaveLength(0);
    expect(noteLevel).toEqual([c]);
  });

  it("degrades to note-level when duplicates can't be disambiguated", () => {
    const doc = "same same same";
    // "same" occurs 3 times; prefix/suffix don't narrow to exactly one.
    const c = comment({ anchorText: "same", prefix: "", suffix: "" });
    const { anchored, noteLevel } = anchorComments(doc, [c]);
    expect(anchored).toHaveLength(0);
    expect(noteLevel).toEqual([c]);
  });

  it("treats comments with empty anchorText as note-level (general comments)", () => {
    const doc = "Any document text.";
    const c = comment({ anchorText: "", body: "General feedback" });
    const { anchored, noteLevel } = anchorComments(doc, [c]);
    expect(anchored).toHaveLength(0);
    expect(noteLevel).toEqual([c]);
  });

  it("handles a mix of anchored, degraded, and note-level comments together", () => {
    const doc = "Alpha beta gamma. Alpha delta epsilon.";
    const clean = comment({ id: "clean", anchorText: "gamma", prefix: "", suffix: "" });
    const ambiguous = comment({ id: "ambiguous", anchorText: "Alpha", prefix: "", suffix: "" });
    const general = comment({ id: "general", anchorText: "", body: "Loved this" });
    const { anchored, noteLevel } = anchorComments(doc, [clean, ambiguous, general]);
    expect(anchored.map((a) => a.comment.id)).toEqual(["clean"]);
    expect(noteLevel.map((n) => n.id)).toEqual(["ambiguous", "general"]);
  });
});

describe("locateAnchor", () => {
  it("returns null for empty anchorText", () => {
    expect(locateAnchor("some text", "", "", "")).toBeNull();
  });

  it("returns the single match when unambiguous", () => {
    const result = locateAnchor("hello world", "world", "", "");
    expect(result).toEqual({ start: 6, end: 11 });
  });
});
