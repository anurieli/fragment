import { describe, it, expect } from "vitest";
import {
  cleanGeneratedTitle,
  titleContext,
  MAX_TITLE_CHARS,
  MAX_TITLE_CONTEXT_CHARS,
} from "@/lib/note-title";
import { DEFAULT_TITLE_PROMPT } from "@/lib/defaults";

describe("cleanGeneratedTitle", () => {
  it("keeps a title that already came back clean", () => {
    expect(cleanGeneratedTitle("The Cost of a Second Opinion")).toBe("The Cost of a Second Opinion");
  });

  it("strips quotes, markdown wrappers and a leading heading marker", () => {
    expect(cleanGeneratedTitle('"The Cost of a Second Opinion"')).toBe("The Cost of a Second Opinion");
    expect(cleanGeneratedTitle("**The Cost of a Second Opinion**")).toBe("The Cost of a Second Opinion");
    expect(cleanGeneratedTitle('# **"The Cost of a Second Opinion"**')).toBe("The Cost of a Second Opinion");
    expect(cleanGeneratedTitle("“The Cost of a Second Opinion”")).toBe("The Cost of a Second Opinion");
  });

  it("drops a Title: preamble and any trailing sentence punctuation", () => {
    expect(cleanGeneratedTitle("Title: The Cost of a Second Opinion.")).toBe("The Cost of a Second Opinion");
    expect(cleanGeneratedTitle("Headline — Writing Under Pressure")).toBe("Writing Under Pressure");
  });

  it("takes the first non-empty line when the model adds commentary", () => {
    expect(cleanGeneratedTitle("\n\nThe Cost of a Second Opinion\n\nLet me know if you want alternatives."))
      .toBe("The Cost of a Second Opinion");
  });

  it("caps at the title limit on a word boundary", () => {
    const long = "Why every single one of the decisions you make before lunch quietly shapes the rest of the day";
    const title = cleanGeneratedTitle(long);
    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(long.startsWith(title)).toBe(true);
    expect(title.endsWith(" ")).toBe(false);
    // Cut on a space, so no half word survives.
    expect(long[title.length]).toBe(" ");
  });

  it("returns an empty string when nothing usable came back", () => {
    expect(cleanGeneratedTitle("")).toBe("");
    expect(cleanGeneratedTitle("   \n  ")).toBe("");
    expect(cleanGeneratedTitle('"""')).toBe("");
  });
});

describe("titleContext", () => {
  it("trims and caps the draft sent as context", () => {
    expect(titleContext("  a short draft  ")).toBe("a short draft");
    expect(titleContext("x".repeat(MAX_TITLE_CONTEXT_CHARS + 500))).toHaveLength(MAX_TITLE_CONTEXT_CHARS);
    expect(titleContext("   ")).toBe("");
  });
});

describe("DEFAULT_TITLE_PROMPT", () => {
  it("asks for the note's metadata as well as its content", () => {
    for (const placeholder of ["{goal}", "{audience}", "{tone}", "{remember}", "{contextAbove}"]) {
      expect(DEFAULT_TITLE_PROMPT).toContain(placeholder);
    }
  });

  it("uses only placeholders the /api/generate substitution knows", () => {
    const known = ["goal", "audience", "tone", "remember", "contextAbove", "contextBelow", "userInstruction"];
    const used = [...DEFAULT_TITLE_PROMPT.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    for (const placeholder of used) expect(known).toContain(placeholder);
  });

  it("substitutes into a prompt carrying both the metadata and the draft", () => {
    // Mirrors the replacement /api/generate and ai-client both perform.
    const prompt = DEFAULT_TITLE_PROMPT
      .replace("{goal}", "Convince skeptical CTOs")
      .replace("{audience}", "Engineering leaders")
      .replace("{tone}", "Direct")
      .replace("{remember}", "No vendor names")
      .replace("{contextAbove}", titleContext("The draft body goes here."));

    expect(prompt).toContain("Convince skeptical CTOs");
    expect(prompt).toContain("Engineering leaders");
    expect(prompt).toContain("Direct");
    expect(prompt).toContain("No vendor names");
    expect(prompt).toContain("The draft body goes here.");
    expect(prompt).not.toMatch(/\{\w+\}/);
  });
});
