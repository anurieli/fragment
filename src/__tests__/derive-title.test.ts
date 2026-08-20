import { describe, it, expect } from "vitest";

import { titleFromText } from "@/lib/derive-title";
import { MAX_TITLE_CHARS } from "@/lib/note-title";

describe("titleFromText", () => {
  it("takes the first line with content", () => {
    expect(titleFromText("\n\n  Hiring is trust calibration\n\nthe rest")).toBe(
      "Hiring is trust calibration",
    );
  });

  it("strips markdown decoration the writer was mid-way through", () => {
    expect(titleFromText("## A heading")).toBe("A heading");
    expect(titleFromText("> a pulled quote")).toBe("a pulled quote");
    expect(titleFromText("- a list item")).toBe("a list item");
  });

  it("collapses runs of whitespace", () => {
    expect(titleFromText("too    many     spaces")).toBe("too many spaces");
  });

  it("returns an empty string when there is nothing to name", () => {
    expect(titleFromText("")).toBe("");
    expect(titleFromText("   \n\n \t ")).toBe("");
  });

  it("never exceeds the cap the rest of the app uses", () => {
    const long = `${"word ".repeat(60)}end`;
    const title = titleFromText(long);

    expect(title.length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });

  it("cuts on a word boundary rather than mid-word", () => {
    const title = titleFromText(`${"alpha ".repeat(30)}omega`);

    expect(title).not.toMatch(/alph…$/);
    expect(title.endsWith("alpha…")).toBe(true);
  });

  it("falls back to a hard cut when there is no word boundary to use", () => {
    const title = titleFromText("x".repeat(200));

    expect(title).toHaveLength(MAX_TITLE_CHARS);
    expect(title.endsWith("…")).toBe(true);
  });
});
