import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  parseSubstackFeed,
  parseFeedItemsRegex,
  fuzzyTitleMatch,
  isValidFeedHost,
  publishPendingState,
} from "@/lib/publish";
import { useContentStore } from "@/stores/content-store";

// ---------------------------------------------------------------------------
// parseSubstackFeed — real-shaped Substack RSS fixtures
// ---------------------------------------------------------------------------

const FEED_PLAIN_TITLES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Voice is the Moat</title>
  <item>
    <title>Why voice is the moat</title>
    <link>https://voiceisthemoat.substack.com/p/why-voice-is-the-moat</link>
    <pubDate>Mon, 21 Jul 2026 14:00:00 GMT</pubDate>
    <description>Some description text.</description>
  </item>
  <item>
    <title>On writing every day</title>
    <link>https://voiceisthemoat.substack.com/p/on-writing-every-day</link>
    <pubDate>Mon, 14 Jul 2026 14:00:00 GMT</pubDate>
  </item>
</channel>
</rss>`;

const FEED_CDATA_TITLES = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title><![CDATA[Voice is the Moat]]></title>
  <item>
    <title><![CDATA[The AI slop problem & how to avoid it]]></title>
    <link>https://voiceisthemoat.substack.com/p/ai-slop-problem</link>
    <pubDate>Wed, 23 Jul 2026 12:30:00 GMT</pubDate>
    <content:encoded><![CDATA[<p>Full HTML body here.</p>]]></content:encoded>
  </item>
</channel>
</rss>`;

const FEED_EMPTY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty Feed</title></channel></rss>`;

describe("parseSubstackFeed", () => {
  it("parses a plain (non-CDATA) feed into title/link/pubDate items", () => {
    const items = parseSubstackFeed(FEED_PLAIN_TITLES);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Why voice is the moat",
      link: "https://voiceisthemoat.substack.com/p/why-voice-is-the-moat",
    });
    expect(items[0].pubDate).toContain("2026");
    expect(items[1].title).toBe("On writing every day");
  });

  it("parses CDATA-wrapped titles, decoding entities inside them", () => {
    const items = parseSubstackFeed(FEED_CDATA_TITLES);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("The AI slop problem & how to avoid it");
    expect(items[0].link).toBe("https://voiceisthemoat.substack.com/p/ai-slop-problem");
  });

  it("returns an empty array for a feed with no items", () => {
    expect(parseSubstackFeed(FEED_EMPTY)).toEqual([]);
  });

  it("never throws on malformed XML — falls back gracefully", () => {
    expect(() => parseSubstackFeed("not xml at all <item>broken")).not.toThrow();
  });
});

describe("parseFeedItemsRegex (Node/no-DOM fallback, tested directly)", () => {
  it("parses the same plain fixture without DOMParser", () => {
    const items = parseFeedItemsRegex(FEED_PLAIN_TITLES);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Why voice is the moat");
  });

  it("decodes CDATA + entities the same way the DOM path does", () => {
    const items = parseFeedItemsRegex(FEED_CDATA_TITLES);
    expect(items[0].title).toBe("The AI slop problem & how to avoid it");
  });
});

// ---------------------------------------------------------------------------
// fuzzyTitleMatch
// ---------------------------------------------------------------------------

describe("fuzzyTitleMatch", () => {
  it("matches an exact title", () => {
    expect(fuzzyTitleMatch("Why voice is the moat", ["Why voice is the moat"])).toBe(true);
  });

  it("matches case- and punctuation-insensitively", () => {
    expect(fuzzyTitleMatch("why VOICE is the moat!!", ["Why voice is the moat"])).toBe(true);
    expect(fuzzyTitleMatch("The AI slop problem: how to avoid it.", [
      "the ai slop problem how to avoid it",
    ])).toBe(true);
  });

  it("matches a lightly edited (near-match) title via similarity fallback", () => {
    // Substack often reflows a title slightly (e.g. an added subtitle clause
    // or a fixed typo) between drafting and publishing.
    expect(
      fuzzyTitleMatch("Why voice is the moat for writers", ["Why voice is the moat for writer"]),
    ).toBe(true);
  });

  it("does not match a clearly different title", () => {
    expect(fuzzyTitleMatch("Why voice is the moat", ["On writing every day"])).toBe(false);
  });

  it("returns false for an empty piece title against any feed", () => {
    expect(fuzzyTitleMatch("", ["Why voice is the moat"])).toBe(false);
    expect(fuzzyTitleMatch("   ", ["Why voice is the moat"])).toBe(false);
  });

  it("returns false against an empty feed title list", () => {
    expect(fuzzyTitleMatch("Why voice is the moat", [])).toBe(false);
  });

  it("truncates comparison to the first 100 characters on the fallback path", () => {
    // Identical for the first 100 chars, then diverge completely — a full
    // (untruncated) comparison would score this as a poor match.
    const piece = "x".repeat(100) + " a completely different tail that would fail a full-string compare";
    const feed = "x".repeat(100) + " an entirely unrelated ending with nothing in common at all";
    expect(fuzzyTitleMatch(piece, [feed])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isValidFeedHost — SSRF shape guard
// ---------------------------------------------------------------------------

describe("isValidFeedHost", () => {
  it("accepts a plain Substack subdomain", () => {
    expect(isValidFeedHost("voiceisthemoat.substack.com")).toBe(true);
  });

  it("accepts an arbitrary custom domain (self-hosted Substack) — shape only", () => {
    expect(isValidFeedHost("blog.example.com")).toBe(true);
    expect(isValidFeedHost("newsletter.somecompany.io")).toBe(true);
  });

  it("rejects a bare hostname with no dot", () => {
    expect(isValidFeedHost("localhost")).toBe(false);
  });

  it("rejects anything carrying a path", () => {
    expect(isValidFeedHost("example.com/feed")).toBe(false);
    expect(isValidFeedHost("example.com/../etc/passwd")).toBe(false);
  });

  it("rejects anything carrying a port", () => {
    expect(isValidFeedHost("example.com:8080")).toBe(false);
  });

  it("rejects a raw IPv4 literal", () => {
    expect(isValidFeedHost("127.0.0.1")).toBe(false);
    expect(isValidFeedHost("10.0.0.5")).toBe(false);
  });

  it("rejects an IPv6 literal", () => {
    expect(isValidFeedHost("::1")).toBe(false);
    expect(isValidFeedHost("[::1]")).toBe(false);
  });

  it("rejects a scheme/full URL smuggled through the pub param", () => {
    expect(isValidFeedHost("https://example.com")).toBe(false);
    expect(isValidFeedHost("http://example.com/feed")).toBe(false);
  });

  it("rejects userinfo (credentials) prefixes", () => {
    expect(isValidFeedHost("user:pass@example.com")).toBe(false);
  });

  it("rejects leading/trailing/doubled dots and hyphens", () => {
    expect(isValidFeedHost(".example.com")).toBe(false);
    expect(isValidFeedHost("example.com.")).toBe(false);
    expect(isValidFeedHost("example..com")).toBe(false);
    expect(isValidFeedHost("-example.com")).toBe(false);
    expect(isValidFeedHost("example.com-")).toBe(false);
  });

  it("rejects empty / non-string input", () => {
    expect(isValidFeedHost("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// publishPendingState — the 24h nudge boundary
// ---------------------------------------------------------------------------

describe("publishPendingState", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it("is 'none' when there's no attempt", () => {
    expect(publishPendingState(undefined, Date.now())).toBe("none");
  });

  it("is 'pending' just under 24h", () => {
    const now = 1_000_000_000_000;
    expect(publishPendingState(now - (DAY_MS - 1), now)).toBe("pending");
  });

  it("is 'nudge' at exactly 24h (boundary is inclusive)", () => {
    const now = 1_000_000_000_000;
    expect(publishPendingState(now - DAY_MS, now)).toBe("nudge");
  });

  it("is 'nudge' well past 24h", () => {
    const now = 1_000_000_000_000;
    expect(publishPendingState(now - DAY_MS * 3, now)).toBe("nudge");
  });

  it("is 'pending' immediately after the attempt (0ms elapsed)", () => {
    const now = 1_000_000_000_000;
    expect(publishPendingState(now, now)).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Pending-state transitions on the content-store (attempt -> verified,
// attempt -> manual)
// ---------------------------------------------------------------------------

vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>("@/lib/persistence");
  return {
    ...actual,
    saveIdea: vi.fn().mockResolvedValue(undefined),
    savePiece: vi.fn().mockResolvedValue(undefined),
  };
});

function resetStore() {
  useContentStore.setState({ ideas: {}, pieces: {}, hydrated: true });
}

describe("pending-state transitions on ContentPiece.publishAttemptedAt", () => {
  beforeEach(resetStore);

  function makePendingPiece() {
    const ideaId = useContentStore.getState().createIdea({ title: "Idea" });
    const id = useContentStore.getState().createPiece({
      ideaId,
      format: "substack",
      origin: "user",
      body: "A Substack draft.",
      status: "ready",
    });
    useContentStore.getState().updatePiece(id, { publishAttemptedAt: Date.now() });
    return id;
  }

  it("attempt -> verified: setPieceStatus('published', verified record) clears publishAttemptedAt", () => {
    const id = makePendingPiece();
    expect(useContentStore.getState().pieces[id].publishAttemptedAt).toBeDefined();

    useContentStore.getState().setPieceStatus(id, "published", {
      platform: "substack",
      method: "copy",
      publishedAt: Date.now(),
      url: "https://example.substack.com/p/a-substack-draft",
      verified: true,
    });

    const piece = useContentStore.getState().pieces[id];
    expect(piece.status).toBe("published");
    expect(piece.publish?.verified).toBe(true);
    expect(piece.publishAttemptedAt).toBeUndefined();
  });

  it("attempt -> manual: marking published manually (no URL) also clears publishAttemptedAt, unverified", () => {
    const id = makePendingPiece();

    useContentStore.getState().setPieceStatus(id, "published", {
      platform: "substack",
      method: "manual",
      publishedAt: Date.now(),
      verified: false,
    });

    const piece = useContentStore.getState().pieces[id];
    expect(piece.status).toBe("published");
    expect(piece.publish?.method).toBe("manual");
    expect(piece.publish?.verified).toBe(false);
    expect(piece.publishAttemptedAt).toBeUndefined();
  });

  it("attempt -> manual with a pasted URL is marked verified", () => {
    const id = makePendingPiece();

    useContentStore.getState().setPieceStatus(id, "published", {
      platform: "substack",
      method: "manual",
      publishedAt: Date.now(),
      url: "https://example.substack.com/p/a-substack-draft",
      verified: true,
    });

    expect(useContentStore.getState().pieces[id].publish?.verified).toBe(true);
    expect(useContentStore.getState().pieces[id].publishAttemptedAt).toBeUndefined();
  });

  it("any other status change (not just publishing) also resolves the pending attempt", () => {
    const id = makePendingPiece();
    useContentStore.getState().setPieceStatus(id, "in-progress");
    expect(useContentStore.getState().pieces[id].publishAttemptedAt).toBeUndefined();
  });
});
