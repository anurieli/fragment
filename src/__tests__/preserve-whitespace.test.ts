import { describe, it, expect } from "vitest";

import {
  preserveWhitespace,
  preserveEmptyParagraphs,
  markdownToCleanHtml,
  markdownToPreviewHtml,
} from "@/lib/publish";

const NBSP = "\u00A0";
// preserveWhitespace emits the entity form at line starts and on empty-
// paragraph lines, because markdown-it's inline trim would eat a raw NBSP
// there. The entity decodes back to a real NBSP in the rendered HTML.
const ENT = "&nbsp;";

describe("preserveWhitespace", () => {
  it("keeps runs of blank lines as visible empty paragraphs", () => {
    // 3 blank lines between a and b: one paragraph break + 2 NBSP paragraphs
    const out = preserveWhitespace("a\n\n\n\nb");
    expect(out).toBe(`a\n\n${ENT}\n\n${ENT}\n\nb`);
  });

  it("a single blank line stays a plain paragraph break", () => {
    expect(preserveWhitespace("a\n\nb")).toBe("a\n\nb");
  });

  it("keeps blank lines at the start of the document", () => {
    expect(preserveWhitespace("\n\nfirst")).toBe(`${ENT}\n\n${ENT}\n\nfirst`);
  });

  it("pins runs of interior spaces with NBSPs, keeping the run's width", () => {
    const out = preserveWhitespace("A   B");
    expect(out).toBe(`A${NBSP}${NBSP} B`);
  });

  it("pins leading indentation with NBSPs so it neither vanishes nor becomes a code block", () => {
    expect(preserveWhitespace("    indented line")).toBe(`${ENT.repeat(4)}indented line`);
  });

  it("does not touch heading, list, or blockquote marker whitespace", () => {
    expect(preserveWhitespace("## Title")).toBe("## Title");
    expect(preserveWhitespace("- a\n  - nested")).toBe("- a\n  - nested");
    expect(preserveWhitespace("> quote")).toBe("> quote");
  });

  it("leaves list continuation indentation alone", () => {
    const md = "- item\n\n    second paragraph of item";
    expect(preserveWhitespace(md)).toBe(md);
  });

  it("leaves fenced code blocks byte-exact, including blank lines inside", () => {
    const md = "```\nline  one\n\n\n    indented\n```";
    expect(preserveWhitespace(md)).toBe(md);
  });

  it("leaves horizontal rules intact", () => {
    expect(preserveWhitespace("a\n\n---\n\nb")).toBe("a\n\n---\n\nb");
  });

  it("keeps trailing spaces (markdown hard-break syntax)", () => {
    expect(preserveWhitespace("hard  \nbreak")).toBe("hard  \nbreak");
  });

  it("is idempotent", () => {
    const md = "a\n\n\n\nb\n\nC   D\n    indent";
    const once = preserveWhitespace(md);
    expect(preserveWhitespace(once)).toBe(once);
  });

  it("rewrites the note editor's NBSP-sentinel lines to the entity form", () => {
    const noteMd = `a\n\n${NBSP}\n\nb`;
    expect(preserveWhitespace(noteMd)).toBe(`a\n\n${ENT}\n\nb`);
  });
});

describe("preserveEmptyParagraphs (note-editor serializer domain)", () => {
  it("encodes each empty paragraph as an NBSP line", () => {
    // prosemirror-markdown: one empty paragraph between a and b = 4 newlines
    expect(preserveEmptyParagraphs("a\n\n\n\nb")).toBe(`a\n\n${NBSP}\n\nb`);
  });

  it("leaves plain paragraph breaks alone", () => {
    expect(preserveEmptyParagraphs("a\n\nb")).toBe("a\n\nb");
  });
});

describe("whitespace survives to rendered HTML", () => {
  it("clean HTML keeps extra blank lines as NBSP paragraphs", () => {
    const html = markdownToCleanHtml("a\n\n\n\nb");
    expect(html).toBe(`<p>a</p>\n<p>${NBSP}</p>\n<p>${NBSP}</p>\n<p>b</p>`);
  });

  it("preview HTML renders every blank line as its own line (literal mode)", () => {
    // The piece read view has zero paragraph margins, so each authored blank
    // line must become a rendered NBSP line for the card to mirror the
    // textarea exactly.
    expect(markdownToPreviewHtml("a\n\nb")).toBe(`<p>a</p>\n<p>${NBSP}</p>\n<p>b</p>`);
    expect(markdownToPreviewHtml("a\n\n\nb")).toBe(
      `<p>a</p>\n<p>${NBSP}</p>\n<p>${NBSP}</p>\n<p>b</p>`,
    );
  });

  it("interior space runs reach the HTML un-collapsed", () => {
    const html = markdownToCleanHtml("A   B");
    expect(html).toContain(`A${NBSP}${NBSP} B`);
  });

  it("dividers still render as <hr>", () => {
    expect(markdownToCleanHtml("a\n\n---\n\nb")).toContain("<hr>");
    expect(markdownToPreviewHtml("a\n\n---\n\nb")).toContain("<hr>");
  });
});
