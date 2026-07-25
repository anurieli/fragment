import type { PublishPlatform } from "./platform";

export const TWEET_CHAR_LIMIT = 280;
export const LINKEDIN_CHAR_LIMIT = 3000;
// Substack articles/newsletters have no hard character limit. The 1000
// figure is a *soft* limit that only applies to Substack Notes (their
// short-form feed post), not to what this module otherwise treats as
// "substack" content (newsletter posts). Exported separately so callers
// building a Notes-specific flow can opt in without this module assuming
// it for every substack platform value.
export const SUBSTACK_NOTES_SOFT_LIMIT = 1000;

/** Hard character limit per platform, or `null` where none applies. */
export const PLATFORM_CHAR_LIMITS: Record<PublishPlatform, number | null> = {
  tweet: TWEET_CHAR_LIMIT,
  linkedin: LINKEDIN_CHAR_LIMIT,
  substack: null,
  html: null,
};

/**
 * Counts user-perceived characters (grapheme clusters) rather than UTF-16
 * code units, so multi-code-unit emoji (e.g. flags, skin-tone modifiers,
 * ZWJ sequences) count as one character each, matching how platforms like
 * X/LinkedIn count length. Falls back to code-point counting
 * (`Array.from`) in environments without `Intl.Segmenter`.
 */
export function charCount(text: string): number {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return Array.from(segmenter.segment(text)).length;
  }
  return Array.from(text).length;
}

export interface TweetSegmentCount {
  text: string;
  count: number;
  over: boolean;
}

// A line containing exactly "---" (surrounding whitespace on that line is
// tolerated) separates individual tweets within a thread. This mirrors the
// "---" delimiter convention already used for frontmatter blocks in
// src/lib/content-engine/frontmatter.ts, applied here to a different
// purpose: splitting one body into per-tweet segments.
function splitThreadSegments(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const segments: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === "---") {
      segments.push(current.join("\n"));
      current = [];
    } else {
      current.push(line);
    }
  }
  segments.push(current.join("\n"));
  return segments;
}

/**
 * Splits a tweet-thread body on "---" separator lines and returns a
 * per-segment character count against `TWEET_CHAR_LIMIT`. Each segment is
 * trimmed before counting (blank lines around a "---" separator are
 * formatting, not tweet content) — a single tweet with no separator at all
 * comes back as a one-element array.
 */
export function countTweetThread(text: string): TweetSegmentCount[] {
  return splitThreadSegments(text).map((segment) => {
    const trimmed = segment.trim();
    const count = charCount(trimmed);
    return { text: trimmed, count, over: count > TWEET_CHAR_LIMIT };
  });
}
