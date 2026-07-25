import type { ReviewComment } from "@/lib/types";

/** A comment successfully located in the document, with its character offsets. */
export interface AnchoredComment {
  comment: ReviewComment;
  start: number;
  end: number;
}

export interface AnchorCommentsResult {
  /** Comments matched to a specific range of `docMarkdown`. */
  anchored: AnchoredComment[];
  /**
   * Comments that couldn't be placed — either because they were authored as
   * note-level comments (empty `anchorText`), their `anchorText` no longer
   * appears in the document, or it appears more than once and `prefix`/
   * `suffix` didn't narrow it down to exactly one occurrence.
   */
  noteLevel: ReviewComment[];
}

/** Every index in `haystack` where `needle` occurs (non-overlapping search, allows overlaps). */
function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const positions: number[] = [];
  let from = 0;
  for (;;) {
    const idx = haystack.indexOf(needle, from);
    if (idx === -1) break;
    positions.push(idx);
    from = idx + 1;
  }
  return positions;
}

/**
 * Locates `anchorText` within `haystack`, using `prefix`/`suffix` to
 * disambiguate when it occurs more than once. Returns `null` when it can't
 * be confidently placed (not found, or still ambiguous after
 * prefix/suffix filtering). Exported standalone (not just via
 * `anchorComments`) so other surfaces — e.g. the "jump to comment in
 * editor" flow in the review panel — can reuse the exact same matching
 * rules against a different text source (live editor text vs. the
 * markdown snapshot the review was generated from).
 */
export function locateAnchor(
  haystack: string,
  anchorText: string,
  prefix: string,
  suffix: string
): { start: number; end: number } | null {
  if (!anchorText) return null;

  const positions = findAllOccurrences(haystack, anchorText);
  if (positions.length === 0) return null;

  if (positions.length === 1) {
    const start = positions[0];
    return { start, end: start + anchorText.length };
  }

  // Duplicate anchor text — narrow down using the surrounding prefix/suffix
  // captured when the comment was created.
  const candidates = positions.filter((start) => {
    const end = start + anchorText.length;
    const before = haystack.slice(0, start);
    const after = haystack.slice(end);
    const prefixOk = !prefix || before.endsWith(prefix);
    const suffixOk = !suffix || after.startsWith(suffix);
    return prefixOk && suffixOk;
  });

  if (candidates.length !== 1) return null;
  const start = candidates[0];
  return { start, end: start + anchorText.length };
}

function locate(docMarkdown: string, comment: ReviewComment): { start: number; end: number } | null {
  return locateAnchor(docMarkdown, comment.anchorText, comment.prefix, comment.suffix);
}

/**
 * Splits reviewer comments into ones that can be anchored to a specific
 * range of `docMarkdown` and ones that degrade to note-level display.
 */
export function anchorComments(docMarkdown: string, comments: ReviewComment[]): AnchorCommentsResult {
  const anchored: AnchoredComment[] = [];
  const noteLevel: ReviewComment[] = [];

  for (const comment of comments) {
    const position = locate(docMarkdown, comment);
    if (position) {
      anchored.push({ comment, start: position.start, end: position.end });
    } else {
      noteLevel.push(comment);
    }
  }

  return { anchored, noteLevel };
}
