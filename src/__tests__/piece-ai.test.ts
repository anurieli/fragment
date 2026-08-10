import { describe, it, expect } from "vitest";
import {
  platformContextHint,
  buildRefineContext,
  buildFlowContext,
  estimateSelectionAnchor,
} from "@/lib/piece-ai";
import { TWEET_CHAR_LIMIT, LINKEDIN_CHAR_LIMIT } from "@/lib/publish";

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
  it("carries the idea's brief through as contextAbove", () => {
    const ctx = buildFlowContext({
      format: "linkedin",
      idea: { title: "Idea title", summary: "Idea summary" },
      ideaBrief: "IDEA: Idea title\n\nALREADY WRITTEN IN THIS IDEA:\n- a thing",
      instruction: "open with the pricing argument",
    });
    expect(ctx.contextAbove).toContain("ALREADY WRITTEN IN THIS IDEA");
    expect(ctx.goal).toBe("Idea title");
    expect(ctx.remember).toContain("Idea summary");
  });

  it("leads with what the writer asked for, and trails the format", () => {
    // Order matters: Flow used to run a canned "draft this as a tweet" with no
    // prompt at all. The typed words are the instruction now, and the format
    // is a shaping note after it rather than the whole request.
    const ctx = buildFlowContext({
      format: "tweet",
      idea: { title: "T" },
      ideaBrief: "",
      instruction: "make it angrier about the pricing",
    });
    expect(ctx.instruction.indexOf("angrier about the pricing")).toBeLessThan(
      ctx.instruction.indexOf("tweet"),
    );
  });

  it("names the target noun per format", () => {
    const base = { ideaBrief: "", instruction: "go" };
    expect(buildFlowContext({ ...base, format: "essay" }).instruction).toContain("piece");
    expect(buildFlowContext({ ...base, format: "script" }).instruction).toContain("script");
  });

  it("trims the typed prompt so stray whitespace never leads the instruction", () => {
    const ctx = buildFlowContext({
      format: "other",
      ideaBrief: "",
      instruction: "   a tight opener  \n",
    });
    expect(ctx.instruction.startsWith("a tight opener")).toBe(true);
  });
});

