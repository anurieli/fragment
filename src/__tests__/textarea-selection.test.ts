import { describe, it, expect } from "vitest";
import { rangeForOffsets } from "@/lib/textarea-selection";
import { highlightMarkdown } from "@/lib/markdown-highlight";

/**
 * The mirror is only a usable ruler for a textarea's selection while its text
 * content matches the textarea's value character for character — the same
 * invariant highlightMarkdown promises. These cover the offset -> DOM mapping
 * across the spans it emits; the pixel hit test itself needs real layout, so
 * it belongs to the browser, not here.
 */
function mirrorFor(markdown: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = highlightMarkdown(markdown);
  return el;
}

describe("rangeForOffsets", () => {
  it("maps offsets that land inside one text node", () => {
    const el = mirrorFor("plain sentence here");
    const range = rangeForOffsets(el, 6, 14);
    expect(range?.toString()).toBe("sentence");
  });

  it("maps offsets that span several styled spans", () => {
    const markdown = "**bold** and *italic* together";
    const el = mirrorFor(markdown);
    expect(el.textContent).toBe(markdown);

    const range = rangeForOffsets(el, 0, markdown.length);
    expect(range?.toString()).toBe(markdown);
  });

  it("maps a selection that crosses a line break", () => {
    const markdown = "# Heading\n\nA line of prose";
    const el = mirrorFor(markdown);
    const start = markdown.indexOf("Heading");
    const end = markdown.indexOf("prose") + "prose".length;

    expect(rangeForOffsets(el, start, end)?.toString()).toBe(
      markdown.slice(start, end),
    );
  });

  it("returns null for an empty or backwards range", () => {
    const el = mirrorFor("some text");
    expect(rangeForOffsets(el, 4, 4)).toBeNull();
    expect(rangeForOffsets(el, 6, 2)).toBeNull();
  });

  it("returns null when the offsets run past the text", () => {
    const el = mirrorFor("short");
    expect(rangeForOffsets(el, 2, 99)).toBeNull();
  });
});
