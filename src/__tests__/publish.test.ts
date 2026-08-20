import { describe, it, expect } from "vitest";

import {
  buildClipboardPayload,
  buildComposerUrl,
  charCount,
  countTweetThread,
  destinationLabel,
  escapeLinkedInReserved,
  markdownToCleanHtml,
  markdownToPreviewHtml,
  markdownToPlainText,
  TWEET_CHAR_LIMIT,
} from "@/lib/publish";

describe("publish — buildClipboardPayload", () => {
  it("tweet: plain text survives byte-exact, including consecutive blank lines and trailing spaces", () => {
    const raw = "First line.   \n\n\n\nSecond line after a triple blank gap.   \n   \nTrailing.  ";
    const payload = buildClipboardPayload(raw, "tweet");
    expect(payload.text).toBe(raw);
    expect(payload.html).toBeUndefined();
  });

  it("linkedin: plain text is the payload, unchanged, with no html flavor and no unicode-bold conversion", () => {
    const raw = "Line one\nLine two\n\n**not converted to unicode bold**";
    const payload = buildClipboardPayload(raw, "linkedin");
    expect(payload.text).toBe(raw);
    expect(payload.html).toBeUndefined();
    // No unicode bold glyphs introduced.
    expect(payload.text).not.toMatch(/[\u{1D400}-\u{1D7FF}]/u);
  });

  it("substack: html flavor preserves structure, text flavor is markdown-stripped", () => {
    const raw = "# Title\n\nSome **bold** text with a [link](https://example.com).";
    const payload = buildClipboardPayload(raw, "substack");
    expect(payload.html).toContain("<h1>Title</h1>");
    expect(payload.html).toContain("<strong>bold</strong>");
    expect(payload.html).toContain('<a href="https://example.com">link</a>');
    expect(payload.text).toBe("Title\n\nSome bold text with a link.");
  });

  it("html: same treatment as substack", () => {
    const raw = "## Sub\n\n*em*";
    const payload = buildClipboardPayload(raw, "html");
    expect(payload.html).toContain("<h2>Sub</h2>");
    expect(payload.text).toBe("Sub\n\nem");
  });
});

describe("publish — markdownToCleanHtml", () => {
  it("renders every supported node type from a single fixture", () => {
    const fixture = [
      "# Heading 1",
      "",
      "## Heading 2",
      "",
      "Some **bold** and *italic* and ***both*** text with a [link](https://example.com).",
      "",
      "- item one",
      "- item two",
      "",
      "1. first",
      "2. second",
      "",
      "> a quote",
      "",
      "---",
      "",
    ].join("\n");

    const html = markdownToCleanHtml(fixture);

    expect(html).toContain("<h1>Heading 1</h1>");
    expect(html).toContain("<h2>Heading 2</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<em><strong>both</strong></em>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>item one</li>");
    expect(html).toContain("<li>item two</li>");
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<li>second</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<p>a quote</p>");
    expect(html).toContain("<hr>");
  });

  it("does not pass raw HTML through (html: false)", () => {
    const html = markdownToCleanHtml('<script>alert("x")</script>\n\nSafe paragraph.');
    expect(html).not.toContain("<script>");
  });
});

describe("publish — markdownToPreviewHtml", () => {
  it("keeps single newlines as line breaks, unlike the clipboard flavor", () => {
    const fixture = "First line\nSecond line";
    expect(markdownToPreviewHtml(fixture)).toContain("<br>");
    expect(markdownToCleanHtml(fixture)).not.toContain("<br>");
  });

  it("renders emphasis, headings, and lists", () => {
    const html = markdownToPreviewHtml("## Title\n\nSome **bold** text\n\n- one\n- two");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<li>one</li>");
  });

  it("escapes raw HTML rather than injecting it", () => {
    const html = markdownToPreviewHtml('<script>alert("x")</script>\n\nSafe.');
    expect(html).not.toContain("<script>");
  });
});

describe("publish — markdownToPlainText", () => {
  it("strips headings, emphasis, links, lists, blockquotes, and hr", () => {
    const fixture = [
      "# Title",
      "",
      "Some **bold** and *italic* and [a link](https://example.com).",
      "",
      "- one",
      "- two",
      "",
      "> quoted",
      "",
      "---",
    ].join("\n");

    const text = markdownToPlainText(fixture);
    expect(text).not.toMatch(/[*_#>-]/);
    expect(text).toContain("Title");
    expect(text).toContain("Some bold and italic and a link.");
    expect(text).toContain("one");
    expect(text).toContain("two");
    expect(text).toContain("quoted");
  });
});

describe("publish — escapeLinkedInReserved", () => {
  const RESERVED = ["\\", "|", "{", "}", "@", "[", "]", "(", ")", "<", ">", "#", "*", "_", "~"];

  it.each(RESERVED)("escapes reserved character %j", (char) => {
    const input = `before${char}after`;
    expect(escapeLinkedInReserved(input)).toBe(`before\\${char}after`);
  });

  it("escapes every reserved character in one pass", () => {
    const input = RESERVED.join("");
    const expected = RESERVED.map((c) => `\\${c}`).join("");
    expect(escapeLinkedInReserved(input)).toBe(expected);
  });

  it("leaves non-reserved characters untouched", () => {
    expect(escapeLinkedInReserved("Hello, world! 123")).toBe("Hello, world! 123");
  });

  // Documented, not enforced: double-escaping is a real risk, not a bug to
  // fix here. Escaping already-escaped text re-escapes the backslashes the
  // first pass introduced, so it is NOT idempotent.
  it("is not idempotent — escaping twice double-escapes (documented risk)", () => {
    const once = escapeLinkedInReserved("(hi)");
    const twice = escapeLinkedInReserved(once);
    expect(once).toBe("\\(hi\\)");
    expect(twice).not.toBe(once);
    expect(twice).toBe("\\\\\\(hi\\\\\\)");
  });
});

describe("publish — countTweetThread", () => {
  it("returns a single segment for a body with no separator", () => {
    const result = countTweetThread("Just one tweet, no thread.");
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Just one tweet, no thread.");
    expect(result[0].count).toBe(charCount("Just one tweet, no thread."));
    expect(result[0].over).toBe(false);
  });

  it("splits on '---' separator lines, consistent with the contract's delimiter convention", () => {
    const body = ["Tweet one.", "", "---", "", "Tweet two.", "---", "Tweet three."].join("\n");
    const result = countTweetThread(body);
    expect(result).toHaveLength(3);
    expect(result[0].text).toBe("Tweet one.");
    expect(result[1].text).toBe("Tweet two.");
    expect(result[2].text).toBe("Tweet three.");
  });

  it("flags a segment over TWEET_CHAR_LIMIT", () => {
    const long = "x".repeat(TWEET_CHAR_LIMIT + 1);
    const result = countTweetThread(long);
    expect(result[0].count).toBe(TWEET_CHAR_LIMIT + 1);
    expect(result[0].over).toBe(true);
  });

  it("does not flag a segment exactly at TWEET_CHAR_LIMIT", () => {
    const exact = "x".repeat(TWEET_CHAR_LIMIT);
    const result = countTweetThread(exact);
    expect(result[0].count).toBe(TWEET_CHAR_LIMIT);
    expect(result[0].over).toBe(false);
  });

  it("counts emoji as single characters via grapheme segmentation", () => {
    // Family emoji: a multi-codepoint ZWJ sequence that should count as 1.
    expect(charCount("👨‍👩‍👧‍👦")).toBe(1);
  });
});

describe("publish — buildComposerUrl", () => {
  it("tweet: url-encodes newlines and special characters", () => {
    const url = buildComposerUrl("tweet", { text: "Line one\nLine two & more?" });
    expect(url).toBe(
      "https://x.com/intent/post?text=" + encodeURIComponent("Line one\nLine two & more?"),
    );
    expect(url).toContain("%0A");
  });

  it("tweet: url-encodes emoji", () => {
    const url = buildComposerUrl("tweet", { text: "Great news 🎉" });
    expect(url).toBe("https://x.com/intent/post?text=" + encodeURIComponent("Great news 🎉"));
    expect(url).toContain("%F0%9F%8E%89");
  });

  it("substack: builds the publish URL from a publication base URL", () => {
    const url = buildComposerUrl("substack", { publicationUrl: "https://myblog.substack.com" });
    expect(url).toBe("https://myblog.substack.com/publish/post?type=newsletter");
  });

  it("substack: strips a trailing slash from the publication base URL", () => {
    const url = buildComposerUrl("substack", { publicationUrl: "https://myblog.substack.com/" });
    expect(url).toBe("https://myblog.substack.com/publish/post?type=newsletter");
  });
});

// ---------------------------------------------------------------------------
// destinationLabel — naming the place a piece went
// ---------------------------------------------------------------------------

describe("destinationLabel", () => {
  it("names a known host by its product name rather than its hostname", () => {
    expect(destinationLabel("https://ariel.substack.com/p/x", "essay")).toBe("Substack");
    expect(destinationLabel("https://www.linkedin.com/feed/update/123", "linkedin")).toBe("LinkedIn");
    expect(destinationLabel("https://x.com/ariel/status/1", "tweet")).toBe("X");
    expect(destinationLabel("https://twitter.com/ariel/status/1", "tweet")).toBe("X");
  });

  // The bug this exists for: a long-form draft published to Substack carries
  // the format "essay", so trusting the format renders "Essay", which names
  // nowhere a reader can go. The URL overrides it.
  it("prefers the URL's host over the piece's format", () => {
    expect(destinationLabel("https://ariel.substack.com/p/x", "essay")).toBe("Substack");
    expect(destinationLabel("https://ariel.substack.com/p/x", "other")).toBe("Substack");
  });

  it("falls back to the bare hostname for a place it does not know", () => {
    expect(destinationLabel("https://blog.example.org/post", "essay")).toBe("blog.example.org");
  });

  it("strips a www. prefix, which nobody reads as part of the name", () => {
    expect(destinationLabel("https://www.example.org/post", "other")).toBe("example.org");
  });

  // A self-hosted Substack runs on a custom domain, so a suffix match cannot be
  // the only route to a name. A custom domain is still a place.
  it("keeps a custom domain as the name", () => {
    expect(destinationLabel("https://letters.arielnurieli.com/p/x", "substack")).toBe(
      "letters.arielnurieli.com",
    );
  });

  it("with no URL, uses the format only when the format is a real platform", () => {
    expect(destinationLabel(undefined, "substack")).toBe("Substack");
    expect(destinationLabel(undefined, "linkedin")).toBe("LinkedIn");
    expect(destinationLabel(undefined, "tweet")).toBe("X");
  });

  // essay / script / other describe a shape of writing, not a destination.
  // Naming one would invent a location the record does not have.
  it("with no URL and a shape-only format, names nothing", () => {
    expect(destinationLabel(undefined, "essay")).toBeNull();
    expect(destinationLabel(undefined, "script")).toBeNull();
    expect(destinationLabel(undefined, "other")).toBeNull();
  });

  it("an unparseable URL falls back to the format rather than dropping the receipt", () => {
    expect(destinationLabel("not a url", "substack")).toBe("Substack");
    expect(destinationLabel("not a url", "essay")).toBeNull();
  });
});
