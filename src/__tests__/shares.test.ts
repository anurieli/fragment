/**
 * Sharing a draft for comment: the parts that can be tested without a
 * database.
 *
 * The load-bearing promise of this feature is that one reviewer never sees
 * another's comments. Most of that lives in SQL and is verified against a
 * real Postgres, but three things are pure and pinned here: the cookie
 * namespacing that keeps two shares from evicting each other, the input
 * sanitising on a public endpoint, and the hosted review page, which must
 * never be able to leak a comment body out of its own string literal.
 */

import { describe, it, expect } from "vitest";

import {
  normalizeEmail,
  looksLikeEmail,
  guestCookieName,
  sanitizeComments,
  MAX_COMMENT_BODY,
  MAX_COMMENTS,
} from "@/lib/server/shares";
import { buildHostedReviewPage } from "@/lib/review";

describe("normalizeEmail", () => {
  it("lowercases and trims, so the same address is one address", () => {
    expect(normalizeEmail("  Alice@Example.COM ")).toBe("alice@example.com");
  });
});

describe("looksLikeEmail", () => {
  it("accepts ordinary and awkward-but-real addresses", () => {
    for (const email of [
      "a@b.co",
      "alice.smith+drafts@example.co.uk",
      "o'brien@example.com",
      "ariel@sub.domain.example.org",
    ]) {
      expect(looksLikeEmail(email), email).toBe(true);
    }
  });

  it("rejects things that are not addresses", () => {
    for (const email of ["", "   ", "alice", "alice@", "@example.com", "a b@example.com", "alice@example"]) {
      expect(looksLikeEmail(email), JSON.stringify(email)).toBe(false);
    }
  });

  it("rejects an address longer than the RFC maximum", () => {
    expect(looksLikeEmail(`${"a".repeat(320)}@example.com`)).toBe(false);
  });
});

describe("guestCookieName", () => {
  it("namespaces per share, so reviewing a second draft doesn't evict the first", () => {
    const a = guestCookieName("2b8f1c7e-0000-4000-8000-000000000001");
    const b = guestCookieName("2b8f1c7e-0000-4000-8000-000000000002");
    expect(a).not.toBe(b);
  });

  it("produces a name with no characters a cookie header can't carry", () => {
    const name = guestCookieName("2b8f1c7e-1234-4000-8000-abcdefabcdef");
    expect(name).toMatch(/^[a-zA-Z0-9_]+$/);
  });
});

describe("sanitizeComments", () => {
  const good = { id: "c1", anchorText: "hello", prefix: "", suffix: "", body: "tighten this" };

  it("keeps a well-formed comment intact", () => {
    expect(sanitizeComments([good])).toEqual([good]);
  });

  it("drops comments with no body, which are not comments", () => {
    expect(sanitizeComments([{ id: "c1", body: "   " }])).toEqual([]);
    expect(sanitizeComments([{ id: "c1" }])).toEqual([]);
  });

  it("drops comments with no id, since there is nothing to upsert on", () => {
    expect(sanitizeComments([{ body: "orphan" }])).toEqual([]);
  });

  it("survives junk instead of an array", () => {
    for (const junk of [null, undefined, "nope", 42, {}]) {
      expect(sanitizeComments(junk)).toEqual([]);
    }
  });

  it("coerces non-string fields rather than throwing", () => {
    const [out] = sanitizeComments([{ id: "c1", body: "ok", anchorText: 12, prefix: null, suffix: {} }]);
    expect(out).toEqual({ id: "c1", body: "ok", anchorText: "", prefix: "", suffix: "" });
  });

  it("truncates an overlong body instead of rejecting the review", () => {
    const [out] = sanitizeComments([{ id: "c1", body: "x".repeat(MAX_COMMENT_BODY + 500) }]);
    expect(out.body).toHaveLength(MAX_COMMENT_BODY);
  });

  it("caps how many comments one submission can carry", () => {
    const many = Array.from({ length: MAX_COMMENTS + 50 }, (_, i) => ({ id: `c${i}`, body: "x" }));
    expect(sanitizeComments(many)).toHaveLength(MAX_COMMENTS);
  });
});

describe("buildHostedReviewPage", () => {
  const note = { title: "On Endings", markdown: "The last line is the one they remember." };
  const base = {
    docId: "share-1",
    submitUrl: "/api/v1/review/tok/submit",
    revision: 3,
    allowEdits: true,
  };

  it("posts to the submit url instead of downloading a file", () => {
    const html = buildHostedReviewPage(note, base);
    expect(html).toContain('"/api/v1/review/tok/submit"');
    expect(html).toContain("var HOSTED = !!SUBMIT_URL");
  });

  it("still produces the offline file when no submitUrl is given", async () => {
    const { buildReviewFile } = await import("@/lib/review");
    const html = buildReviewFile(note, {});
    expect(html).toContain('var SUBMIT_URL = ""');
    expect(html).toContain(".fragment-review.json");
  });

  it("carries the revision back so stale anchors are detectable", () => {
    expect(buildHostedReviewPage(note, base)).toContain("var REVISION = 3");
  });

  it("seeds the reviewer's own comments", () => {
    const html = buildHostedReviewPage(note, {
      ...base,
      initialComments: [{ id: "c1", anchorText: "last line", prefix: "", suffix: "", body: "cut this" }],
    });
    expect(html).toContain("cut this");
  });

  it("does not let a comment body break out of the script tag", () => {
    // A reviewer types </script> into a comment. If the serialiser emitted it
    // literally, the browser would end the script early and render the rest
    // of the payload as markup — script injection via a comment body.
    const html = buildHostedReviewPage(note, {
      ...base,
      initialComments: [
        {
          id: "c1",
          anchorText: "",
          prefix: "",
          suffix: "",
          body: "</script><img src=x onerror=alert(1)>",
        },
      ],
    });
    const scriptOpens = html.split("<script>").length - 1;
    const scriptCloses = html.split("</script>").length - 1;
    expect(scriptCloses).toBe(scriptOpens);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("\\u003c/script");
  });

  it("does not let a title break out of the script tag either", () => {
    // Same class of bug as the comment body above, reachable through a note
    // title. The title is escaped where it lands in markup, but it is also
    // injected into the script block as a literal, and that copy needs its
    // own escaping.
    const html = buildHostedReviewPage(
      { title: '</script><img src=x onerror=alert(1)>', markdown: "body" },
      base,
    );
    expect(html.split("</script>").length - 1).toBe(html.split("<script>").length - 1);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("does not let an author name break out of the script tag", () => {
    const html = buildHostedReviewPage(note, {
      ...base,
      authorName: "</script><img src=x onerror=alert(1)>",
    });
    expect(html.split("</script>").length - 1).toBe(html.split("<script>").length - 1);
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
  });

  it("tells the page to lock editing when the owner disallowed it", () => {
    expect(buildHostedReviewPage(note, { ...base, allowEdits: false })).toContain(
      "var ALLOW_EDITS = false",
    );
  });

  it("never discloses the author's email to guests", () => {
    const html = buildHostedReviewPage(note, { ...base, authorName: "Ariel", authorEmail: "" });
    expect(html).toContain('var AUTHOR_EMAIL = ""');
    expect(html).toContain("Ariel");
  });
});
