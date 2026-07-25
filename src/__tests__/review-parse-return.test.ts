import { describe, it, expect } from "vitest";
import { parseReviewReturn } from "@/lib/review";

function validPayload() {
  return {
    docId: "doc-123",
    reviewerName: "Jamie",
    timestamp: 1_700_000_000_000,
    comments: [
      { id: "c1", anchorText: "opening line", prefix: "the ", suffix: " of the", body: "Nice hook." },
      { id: "c2", anchorText: "", prefix: "", suffix: "", body: "Overall great draft." },
    ],
  };
}

describe("parseReviewReturn", () => {
  it("parses a well-formed review return", () => {
    const result = parseReviewReturn(JSON.stringify(validPayload()));
    expect(result.docId).toBe("doc-123");
    expect(result.reviewerName).toBe("Jamie");
    expect(result.comments).toHaveLength(2);
    expect(result.comments[0].anchorText).toBe("opening line");
  });

  it("parses editedFullText when present", () => {
    const payload = { ...validPayload(), editedFullText: "Some edited body text." };
    const result = parseReviewReturn(JSON.stringify(payload));
    expect(result.editedFullText).toBe("Some edited body text.");
  });

  it("editedFullText is undefined when absent", () => {
    const result = parseReviewReturn(JSON.stringify(validPayload()));
    expect(result.editedFullText).toBeUndefined();
  });

  it("throws on invalid JSON", () => {
    expect(() => parseReviewReturn("{not json")).toThrow();
  });

  it("throws when required fields are missing", () => {
    const bad = { reviewerName: "Jamie", comments: [] };
    expect(() => parseReviewReturn(JSON.stringify(bad))).toThrow();
  });

  it("throws when a comment is missing a body", () => {
    const bad = {
      ...validPayload(),
      comments: [{ id: "c1", anchorText: "x", prefix: "", suffix: "", body: "" }],
    };
    expect(() => parseReviewReturn(JSON.stringify(bad))).toThrow();
  });

  it("throws when comments is not an array", () => {
    const bad = { ...validPayload(), comments: "nope" };
    expect(() => parseReviewReturn(JSON.stringify(bad))).toThrow();
  });

  it("throws when timestamp is not a number", () => {
    const bad = { ...validPayload(), timestamp: "not-a-number" };
    expect(() => parseReviewReturn(JSON.stringify(bad))).toThrow();
  });

  it("throws on a top-level array instead of an object", () => {
    expect(() => parseReviewReturn(JSON.stringify([1, 2, 3]))).toThrow();
  });
});
