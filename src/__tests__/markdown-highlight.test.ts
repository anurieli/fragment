import { describe, it, expect } from "vitest";

import { highlightMarkdown } from "@/lib/markdown-highlight";

/** Undo what highlightMarkdown did: drop the spans, unescape the entities. */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

const FIXTURES: [string, string][] = [
  ["empty", ""],
  ["plain prose", "Just a sentence with nothing special in it."],
  ["heading", "## Why the inbox has to reach zero"],
  ["deep heading", "###### six deep"],
  ["bold", "An inbox that **only grows** is a backlog."],
  ["italic", "It is *actually* just refusing to help."],
  ["bold italic", "This is ***really*** the point."],
  ["underscores", "__bold__ and _italic_ both count."],
  ["code", "Run `npm run build` first."],
  ["strikethrough", "~~scratch that~~ never mind."],
  ["link", "See [the docs](https://example.com/a?b=c&d=e) for more."],
  ["image", "![alt text](https://example.com/x.png)"],
  ["bullets", "- pick it up\n- ship it\n- drop it"],
  ["numbered", "1. first\n2) second"],
  ["quote", "> a quote\n> continued"],
  ["rule", "---"],
  ["html-ish", "5 < 6 && 7 > 6 <script>alert(\"x\")</script>"],
  ["unmatched markers", "a ** dangling and one * lonely star"],
  ["trailing spaces", "Line one.   \n\n\n\nLine two.   \n   \nTrailing.  "],
  ["only newlines", "\n\n\n"],
  ["mixed", "# Title\n\nSome **bold** and a [link](url).\n\n- item `code`\n\n> quote **inside**\n\n---\n"],
  ["emoji", "Great news 🎉 **really** 👨‍👩‍👧‍👦"],
];

describe("markdown-highlight — the text survives, exactly", () => {
  it.each(FIXTURES)("preserves every character: %s", (_name, source) => {
    expect(stripTags(highlightMarkdown(source))).toBe(source);
  });

  it("preserves text through a long adversarial mix of markers", () => {
    const source = FIXTURES.map(([, s]) => s).join("\n\n") + "\n***\n`` ` ``\n[](){}<>&";
    expect(stripTags(highlightMarkdown(source))).toBe(source);
  });

  it("never emits <br> — newlines stay literal for white-space: pre-wrap", () => {
    const html = highlightMarkdown("one\ntwo\nthree");
    expect(html).not.toContain("<br");
    expect(html.split("\n")).toHaveLength(3);
  });

  it("escapes markup rather than injecting it", () => {
    const html = highlightMarkdown('<script>alert("x")</script>');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("markdown-highlight — what gets styled", () => {
  it("dims the marker and styles the content, separately", () => {
    const html = highlightMarkdown("a **bold** word");
    expect(html).toContain('<span class="md-mark">**</span>');
    expect(html).toContain('<span class="md-strong">bold</span>');
  });

  it("marks a heading's hashes and its text apart", () => {
    const html = highlightMarkdown("## Title");
    expect(html).toContain('<span class="md-mark">## </span>');
    expect(html).toContain('<span class="md-heading">Title</span>');
  });

  it("styles a link's label and its url differently", () => {
    const html = highlightMarkdown("[label](https://example.com)");
    expect(html).toContain('<span class="md-link">label</span>');
    expect(html).toContain('<span class="md-url">https://example.com</span>');
  });

  it("styles list and quote markers without touching their prose", () => {
    expect(highlightMarkdown("- item")).toContain('<span class="md-mark">- </span>');
    expect(highlightMarkdown("> quoted")).toContain('<span class="md-quote">quoted</span>');
  });

  it("leaves ordinary prose entirely unwrapped", () => {
    expect(highlightMarkdown("nothing to see here")).toBe("nothing to see here");
  });
});
