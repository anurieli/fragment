// Substack verified-publish loop support: parsing an RSS feed, fuzzy-matching
// a fragment title against it, an SSRF-shape guard for the rss-proxy
// route, and a small pure helper for the "awaiting confirmation" badge's
// pending/nudge state. Everything here is pure (no network, no DOM
// mutation beyond a throwaway DOMParser document) so it's fully unit
// tested independent of the fetch/polling wiring in
// src/hooks/use-publish-verification.ts and src/app/api/v1/rss-proxy/route.ts.

export interface FeedItem {
  title: string;
  link: string;
  pubDate: string;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function extractTag(itemXml: string, tag: string): string {
  const match = itemXml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXmlEntities(match[1]) : "";
}

/**
 * Regex/string-based RSS `<item>` parser — no DOM required. This is the
 * fallback `parseSubstackFeed` uses when `DOMParser` isn't available (plain
 * Node, e.g. a future server-side verification job), and it's also directly
 * unit-tested so CDATA/entity handling is locked down independent of the
 * DOMParser code path.
 */
export function parseFeedItemsRegex(xml: string): FeedItem[] {
  const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  return itemMatches.map((itemXml) => ({
    title: extractTag(itemXml, "title"),
    link: extractTag(itemXml, "link"),
    pubDate: extractTag(itemXml, "pubDate"),
  }));
}

function parseFeedItemsDom(xml: string): FeedItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) {
    throw new Error("invalid XML");
  }
  return Array.from(doc.querySelectorAll("item")).map((node) => ({
    title: node.querySelector("title")?.textContent?.trim() ?? "",
    link: node.querySelector("link")?.textContent?.trim() ?? "",
    pubDate: node.querySelector("pubDate")?.textContent?.trim() ?? "",
  }));
}

/**
 * Parses a Substack (or any RSS 2.0) feed's XML into `[{title, link,
 * pubDate}]`. Uses `DOMParser` when it's available (browser, Tauri
 * WebView, happy-dom test env), falling back to the regex/string parser in
 * plain Node. Never throws on malformed input — a DOMParser parse error
 * (or any exception) falls back to the regex parser rather than surfacing
 * an error to a polling hook that should just try again next tick.
 */
export function parseSubstackFeed(xml: string): FeedItem[] {
  if (typeof DOMParser !== "undefined") {
    try {
      return parseFeedItemsDom(xml);
    } catch {
      return parseFeedItemsRegex(xml);
    }
  }
  return parseFeedItemsRegex(xml);
}

// ---------------------------------------------------------------------------
// Fuzzy title match
// ---------------------------------------------------------------------------

function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Classic Levenshtein edit distance, O(n*m) time / O(m) space. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prevRow = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prevRow[j] = j;

  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prevRow[0];
    prevRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prevRow[j];
      prevRow[j] =
        a[i - 1] === b[j - 1]
          ? prevDiag
          : 1 + Math.min(prevDiag, prevRow[j], prevRow[j - 1]);
      prevDiag = tmp;
    }
  }
  return prevRow[b.length];
}

/** 1 = identical, 0 = maximally different. Normalized by the longer string's length. */
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Fuzzy-matches a piece's title (or first line, for body-only pieces)
 * against a list of feed item titles. Case/punctuation-insensitive exact
 * match first (handles Substack's own title normalization, e.g. smart
 * quotes); falls back to a first-100-normalized-characters similarity
 * (normalized Levenshtein) >= 0.8, which tolerates the kind of light
 * copyediting a title picks up between drafting and hitting publish.
 * Pure — no I/O, safe to call on every poll tick.
 */
export function fuzzyTitleMatch(pieceTitleOrFirstLine: string, feedTitles: readonly string[]): boolean {
  const normalizedPiece = normalizeForMatch(pieceTitleOrFirstLine);
  if (!normalizedPiece) return false;

  for (const feedTitle of feedTitles) {
    if (normalizeForMatch(feedTitle) === normalizedPiece) return true;
  }

  const pieceHead = normalizedPiece.slice(0, 100);
  for (const feedTitle of feedTitles) {
    const feedHead = normalizeForMatch(feedTitle).slice(0, 100);
    if (feedHead && similarity(pieceHead, feedHead) >= 0.8) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// SSRF guard for the rss-proxy route
// ---------------------------------------------------------------------------

const HOST_SHAPE = /^[a-z0-9.-]+$/i;
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Validates that `host` is a bare hostname the rss-proxy route may safely
 * fetch `https://<host>/feed` from. Deliberately permissive on *which*
 * domain (self-hosted Substacks run on arbitrary custom domains — there's
 * no fixed allowlist to check against) and strict on *shape*: no scheme,
 * userinfo, port, path, query, or fragment; must be a dot-separated
 * multi-label domain (rejects bare hostnames and raw IPv4 literals); no
 * leading/trailing/doubled dots or hyphens. `/^[a-z0-9.-]+$/i` alone
 * already rejects anything containing `/`, `:`, `@`, `?`, `#`, or
 * whitespace, which is what rules out paths, ports, and full URLs being
 * smuggled in through the `pub` query param.
 */
export function isValidFeedHost(host: string): boolean {
  if (typeof host !== "string" || host.length === 0 || host.length > 253) return false;
  if (!HOST_SHAPE.test(host)) return false;
  if (!host.includes(".")) return false;
  if (host.includes("..")) return false;
  if (host.startsWith(".") || host.endsWith(".")) return false;
  if (host.startsWith("-") || host.endsWith("-")) return false;
  if (IPV4_LITERAL.test(host)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pending / nudge badge state
// ---------------------------------------------------------------------------

const PENDING_NUDGE_MS = 24 * 60 * 60 * 1000;

export type PublishPendingState = "none" | "pending" | "nudge";

/**
 * Presentational state for the "awaiting confirmation" badge on a fragment
 * card or in the draft editor: `"pending"` while a Substack publish attempt is
 * younger than 24h, `"nudge"` once it's 24h old or older (a gentle "did
 * this go live?" prompt — no modal, per the spec), `"none"` when there's no
 * attempt in flight (`attemptedAt` undefined). Pure, so the 24h boundary is
 * unit-tested without any timer/hook wiring.
 */
export function publishPendingState(attemptedAt: number | undefined, now: number): PublishPendingState {
  if (attemptedAt === undefined) return "none";
  return now - attemptedAt >= PENDING_NUDGE_MS ? "nudge" : "pending";
}
