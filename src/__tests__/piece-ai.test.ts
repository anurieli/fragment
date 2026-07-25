import { describe, it, expect } from "vitest";
import {
  platformContextHint,
  buildRefineContext,
  buildFlowContext,
  findLinkedNoteId,
  findLinkedNoteContent,
  resolveSnipTargetNoteId,
  estimateSelectionAnchor,
  type PieceLike,
} from "@/lib/piece-ai";
import { TWEET_CHAR_LIMIT, LINKEDIN_CHAR_LIMIT } from "@/lib/publish";

function makePiece(overrides: Partial<PieceLike> = {}): PieceLike {
  return {
    id: "piece-1",
    ideaId: "idea-1",
    updatedAt: 1000,
    ...overrides,
  };
}

describe("platformContextHint", () => {
  it("returns null for formats with no publish platform", () => {
    expect(platformContextHint("essay", "some text")).toBeNull();
    expect(platformContextHint("script", "some text")).toBeNull();
    expect(platformContextHint("other", "some text")).toBeNull();
  });

  it("states the hard limit for a tweet under the limit", () => {
    const hint = platformContextHint("tweet", "short tweet");
    expect(hint).toBe(`This is a tweet segment, hard limit ${TWEET_CHAR_LIMIT} characters.`);
    expect(hint).not.toMatch(/over the limit/);
  });

  it("flags an over-limit tweet so Concise aims under the cap", () => {
    const overLimitBody = "x".repeat(TWEET_CHAR_LIMIT + 40);
    const hint = platformContextHint("tweet", overLimitBody);
    expect(hint).toContain(`hard limit ${TWEET_CHAR_LIMIT} characters`);
    expect(hint).toContain("over the limit");
    expect(hint).toContain(`aim to bring it under ${TWEET_CHAR_LIMIT}`);
  });

  it("states the hard limit for LinkedIn", () => {
    const hint = platformContextHint("linkedin", "a post");
    expect(hint).toContain(`hard limit ${LINKEDIN_CHAR_LIMIT} characters`);
  });

  it("flags an over-limit LinkedIn post", () => {
    const overLimitBody = "x".repeat(LINKEDIN_CHAR_LIMIT + 1);
    const hint = platformContextHint("linkedin", overLimitBody);
    expect(hint).toContain("over the limit");
  });

  it("notes Substack has no hard character limit", () => {
    const hint = platformContextHint("substack", "a very long newsletter post");
    expect(hint).toBe("This is a Substack post. No hard character limit.");
  });
});

describe("buildRefineContext", () => {
  it("slices before/after context around the selection", () => {
    const body = "The quick brown fox jumps over the lazy dog.";
    const ctx = buildRefineContext({
      format: "essay",
      body,
      selectionStart: 4,
      selectionEnd: 15, // "quick brown"
    });
    expect(ctx.contextBefore).toBe("The ");
    expect(ctx.contextAfter).toBe(" fox jumps over the lazy dog.");
  });

  it("uses the idea's title as goal and folds summary + platform hint into remember", () => {
    const ctx = buildRefineContext({
      format: "tweet",
      body: "hello world",
      selectionStart: 0,
      selectionEnd: 5,
      idea: { title: "Launch announcement", summary: "Big product launch", voiceId: "v1" },
    });
    expect(ctx.goal).toBe("Launch announcement");
    expect(ctx.remember).toContain("Big product launch");
    expect(ctx.remember).toContain(`hard limit ${TWEET_CHAR_LIMIT} characters`);
    expect(ctx.voiceId).toBe("v1");
  });

  it("passes idea.voiceId through undefined when the idea has none (default-voice chain)", () => {
    const ctx = buildRefineContext({
      format: "essay",
      body: "text",
      selectionStart: 0,
      selectionEnd: 4,
      idea: { title: "No voice idea" },
    });
    expect(ctx.voiceId).toBeUndefined();
  });

  it("omits remember entirely when there is no idea summary and no platform hint", () => {
    const ctx = buildRefineContext({
      format: "essay",
      body: "text",
      selectionStart: 0,
      selectionEnd: 4,
      idea: { title: "No summary" },
    });
    expect(ctx.remember).toBe("");
  });

  it("clamps an out-of-range selection to the body bounds instead of throwing", () => {
    const body = "short";
    const ctx = buildRefineContext({ format: "essay", body, selectionStart: -5, selectionEnd: 999 });
    expect(ctx.contextBefore).toBe("");
    expect(ctx.contextAfter).toBe("");
  });
});

describe("buildFlowContext", () => {
  it("uses the linked note content as contextAbove", () => {
    const ctx = buildFlowContext({
      format: "linkedin",
      idea: { title: "Idea title", summary: "Idea summary" },
      linkedNoteContent: "Full long-form draft content.",
    });
    expect(ctx.contextAbove).toBe("Full long-form draft content.");
    expect(ctx.goal).toBe("Idea title");
    expect(ctx.remember).toContain("Idea summary");
    expect(ctx.instruction).toContain("LinkedIn post");
  });

  it("falls back to an empty contextAbove when there is no linked note", () => {
    const ctx = buildFlowContext({ format: "tweet", idea: { title: "T" }, linkedNoteContent: null });
    expect(ctx.contextAbove).toBe("");
    expect(ctx.instruction).toContain("tweet");
  });

  it("names the draft noun per format", () => {
    expect(buildFlowContext({ format: "essay" }).instruction).toContain("piece");
    expect(buildFlowContext({ format: "script" }).instruction).toContain("script");
  });
});

describe("findLinkedNoteId / findLinkedNoteContent", () => {
  it("finds the idea's long-form sibling piece by noteId", () => {
    const pieces: PieceLike[] = [
      makePiece({ id: "p-tweet", ideaId: "idea-1", noteId: undefined, updatedAt: 500 }),
      makePiece({ id: "p-essay", ideaId: "idea-1", noteId: "note-1", updatedAt: 1000 }),
      makePiece({ id: "p-other-idea", ideaId: "idea-2", noteId: "note-2", updatedAt: 2000 }),
    ];
    expect(findLinkedNoteId("idea-1", pieces)).toBe("note-1");
  });

  it("picks the most-recently-updated long-form piece when there are several", () => {
    const pieces: PieceLike[] = [
      makePiece({ id: "p-old", ideaId: "idea-1", noteId: "note-old", updatedAt: 100 }),
      makePiece({ id: "p-new", ideaId: "idea-1", noteId: "note-new", updatedAt: 900 }),
    ];
    expect(findLinkedNoteId("idea-1", pieces)).toBe("note-new");
  });

  it("ignores deleted pieces", () => {
    const pieces: PieceLike[] = [
      makePiece({ id: "p-deleted", ideaId: "idea-1", noteId: "note-1", deletedAt: 123 }),
    ];
    expect(findLinkedNoteId("idea-1", pieces)).toBeNull();
  });

  it("returns null when the idea has no long-form piece", () => {
    const pieces: PieceLike[] = [makePiece({ ideaId: "idea-1", noteId: undefined })];
    expect(findLinkedNoteId("idea-1", pieces)).toBeNull();
  });

  it("resolves the note's content through the notes map", () => {
    const pieces: PieceLike[] = [makePiece({ ideaId: "idea-1", noteId: "note-1" })];
    const notes = { "note-1": { content: "the draft" } };
    expect(findLinkedNoteContent("idea-1", pieces, notes)).toBe("the draft");
  });

  it("returns null content when the linked note id doesn't resolve in the notes map", () => {
    const pieces: PieceLike[] = [makePiece({ ideaId: "idea-1", noteId: "missing-note" })];
    expect(findLinkedNoteContent("idea-1", pieces, {})).toBeNull();
  });
});

describe("resolveSnipTargetNoteId", () => {
  it("prefers the idea's own linked note", () => {
    const pieces: PieceLike[] = [makePiece({ ideaId: "idea-1", noteId: "note-linked" })];
    const noteIds = new Set(["note-linked", "note-active"]);
    expect(resolveSnipTargetNoteId("idea-1", pieces, noteIds, "note-active")).toBe("note-linked");
  });

  it("falls back to the active note when the idea has no linked note", () => {
    const pieces: PieceLike[] = [];
    const noteIds = new Set(["note-active"]);
    expect(resolveSnipTargetNoteId("idea-1", pieces, noteIds, "note-active")).toBe("note-active");
  });

  it("falls back to the active note when the linked note id no longer exists", () => {
    const pieces: PieceLike[] = [makePiece({ ideaId: "idea-1", noteId: "note-deleted" })];
    const noteIds = new Set(["note-active"]);
    expect(resolveSnipTargetNoteId("idea-1", pieces, noteIds, "note-active")).toBe("note-active");
  });

  it("returns null when there is nowhere to put the snippet", () => {
    const pieces: PieceLike[] = [];
    const noteIds = new Set<string>();
    expect(resolveSnipTargetNoteId("idea-1", pieces, noteIds, null)).toBeNull();
  });
});

describe("estimateSelectionAnchor", () => {
  const geometry = { top: 100, left: 20, scrollTop: 0, lineHeight: 18 };

  it("anchors at the textarea top for a selection on the first line", () => {
    const anchor = estimateSelectionAnchor("hello world", 3, geometry);
    expect(anchor).toEqual({ top: 100, left: 20 });
  });

  it("moves down one line height per newline before the selection", () => {
    const value = "line one\nline two\nline three";
    const selectionStart = value.indexOf("line three");
    const anchor = estimateSelectionAnchor(value, selectionStart, geometry);
    expect(anchor.top).toBe(100 + 2 * 18);
    expect(anchor.left).toBe(20);
  });

  it("subtracts scrollTop so a scrolled textarea's line stays under the cursor", () => {
    const value = "line one\nline two";
    const selectionStart = value.indexOf("line two");
    const anchor = estimateSelectionAnchor(value, selectionStart, { ...geometry, scrollTop: 18 });
    expect(anchor.top).toBe(100); // one line down, minus one line scrolled = back at top
  });

  it("never anchors above the textarea's own top edge", () => {
    const value = "line one\nline two\nline three";
    const selectionStart = value.indexOf("line three");
    // Scrolled far down — raw math would go negative relative to top.
    const anchor = estimateSelectionAnchor(value, selectionStart, { ...geometry, scrollTop: 1000 });
    expect(anchor.top).toBe(geometry.top);
  });
});
