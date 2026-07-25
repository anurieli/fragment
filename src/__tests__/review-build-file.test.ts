import { describe, it, expect } from "vitest";
import { buildReviewFile, reviewFileName } from "@/lib/review";

describe("buildReviewFile", () => {
  const note = {
    title: "The Long Way Home",
    markdown: "# The Long Way Home\n\nThis is the **opening** line of the essay.\n\n> A quote worth keeping.",
  };

  it("produces a valid HTML skeleton", () => {
    const html = buildReviewFile(note);
    expect(html.trim().toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(html).toMatch(/<html[\s>]/i);
    expect(html).toMatch(/<head>[\s\S]*<\/head>/i);
    expect(html).toMatch(/<body>[\s\S]*<\/body>/i);
    expect(html).toMatch(/<title>[\s\S]*<\/title>/i);
  });

  it("embeds the rendered document content", () => {
    const html = buildReviewFile(note);
    expect(html).toContain("opening");
    expect(html).toContain("quote worth keeping");
    expect(html).toContain("The Long Way Home");
  });

  it("embeds a generated docId used as the autosave key", () => {
    const html = buildReviewFile(note);
    // docId is threaded into the inline script as the localStorage key prefix.
    expect(html).toMatch(/fragment-review:/);
    // Two independent builds get different docIds (autosave doesn't collide).
    const html2 = buildReviewFile(note);
    const idMatch = /var DOC_ID = "([^"]+)"/;
    const id1 = html.match(idMatch)?.[1];
    const id2 = html2.match(idMatch)?.[1];
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it("makes no external network requests except the footer github link", () => {
    const html = buildReviewFile(note);
    const matches = [...html.matchAll(/(?:src|href)\s*=\s*["'](https?:\/\/[^"']+)["']/gi)].map((m) => m[1]);
    expect(matches.length).toBeGreaterThan(0); // sanity: the footer link exists
    for (const url of matches) {
      expect(url).toBe("https://github.com/anurieli/fragment");
    }
  });

  it("has no other bare http(s) URLs anywhere in the page (fonts, CDNs, etc.)", () => {
    const html = buildReviewFile(note);
    const all = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    for (const url of all) {
      expect(url.replace(/[.,;]+$/, "")).toBe("https://github.com/anurieli/fragment");
    }
  });

  it("includes the author's name when provided", () => {
    const html = buildReviewFile(note, { authorName: "Ariel Nurieli", authorEmail: "ariel@example.com" });
    expect(html).toContain("Ariel Nurieli");
    expect(html).toContain("ariel@example.com");
  });

  it("falls back to 'Untitled' for a blank title", () => {
    const html = buildReviewFile({ title: "   ", markdown: "content" });
    expect(html).toMatch(/Untitled/);
  });
});

describe("reviewFileName", () => {
  it("sanitizes the title into a filename", () => {
    expect(reviewFileName("My Essay: A Draft!")).toBe("my-essay-a-draft.review.html");
  });

  it("falls back to 'untitled' for an empty title", () => {
    expect(reviewFileName("   ")).toBe("untitled.review.html");
  });
});
