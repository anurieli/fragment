const NBSP = "\u00A0";
// markdown-it trims each paragraph's inline content with String.trim(), which
// eats U+00A0 too: a raw NBSP at the start or end of a line (or alone on one)
// vanishes. The `&nbsp;` entity survives that trim (it is ASCII in the source)
// and markdown-it decodes entities even with html:false, so it reaches the
// HTML as a real NBSP. Raw NBSP is still used *inside* lines, where trim
// can't reach and where an entity would print literally inside code spans.
const NBSP_ENTITY = "&nbsp;";
// A line that is (possibly padded) NBSP: the note editor's stored sentinel
// for an intentionally empty paragraph.
const NBSP_ONLY_LINE = /^[ \t\u00A0]*\u00A0[ \t\u00A0]*$/;

// A markdown "blank" line is spaces/tabs only. Deliberately NOT String.trim():
// trim() also removes U+00A0, and NBSP-only lines are the app's sentinel for
// an intentionally kept empty paragraph; they must count as content here.
const BLANK_LINE = /^[ \t]*$/;
const FENCE_LINE = /^ {0,3}(?:```|~~~)/;
const HR_LINE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
// Structural prefixes whose surrounding whitespace markdown itself depends on.
const BLOCK_MARKER = /^(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d{1,9}[.)][ \t]+)/;
const LIST_MARKER = /^(?:[-*+]|\d{1,9}[.)])[ \t]/;

/**
 * Encode empty paragraphs as NBSP lines so they survive the markdown
 * round-trip out of the Tiptap note editor. prosemirror-markdown serializes N
 * empty paragraphs as 2*(N+1) newlines; markdown-it collapses those back to a
 * single paragraph break. Putting a NBSP on each "empty" line makes it a real
 * paragraph for the parser. Use this on serializer output (notes); use
 * `preserveWhitespace` on raw authored text (pieces) and at render time.
 */
export function preserveEmptyParagraphs(md: string): string {
  return md.replace(/\n{3,}/g, (match) => {
    const emptyCount = Math.floor((match.length - 2) / 2);
    return "\n\n" + `${NBSP}\n\n`.repeat(emptyCount);
  });
}

/** Runs of 2+ spaces become NBSPs plus one real space, so the run keeps its
 * width in rendered HTML while the line can still wrap. */
function hardenSpaces(text: string): string {
  return text.replace(/ {2,}/g, (run) => NBSP.repeat(run.length - 1) + " ");
}

function transformLine(line: string, listContext: boolean): string {
  if (HR_LINE.test(line)) return line;

  const match = line.match(/^( *)(.*?)([ \t]*)$/) as RegExpMatchArray;
  const leading = match[1];
  let core = match[2];
  const trailing = match[3];

  // Peel structural markdown prefixes (headings, blockquotes, list markers) so
  // space-hardening never eats the whitespace their syntax requires.
  let prefix = "";
  let m: RegExpMatchArray | null;
  while ((m = core.match(BLOCK_MARKER))) {
    prefix += m[0];
    core = core.slice(m[0].length);
    // Heading content follows the marker verbatim; stop peeling so a title
    // like "# 1. Intro" keeps its "1." as text.
    if (m[0].startsWith("#")) break;
  }

  // Leading spaces: markdown either strips them or turns 4+ into a code block.
  // In this app they are visual indentation, so pin them with NBSP entities,
  // except inside list/quote structure, where indentation is markdown's own
  // syntax (nested items, continuation paragraphs) and must stay real.
  const indent =
    leading.length > 0 && prefix === "" && !listContext
      ? NBSP_ENTITY.repeat(leading.length)
      : leading;

  return indent + prefix + hardenSpaces(core) + trailing;
}

/**
 * Rewrites markdown so the author's spacing survives rendering:
 *
 * - Runs of blank lines become explicit NBSP paragraphs (markdown collapses
 *   any number of blank lines into a single paragraph break).
 * - Leading indentation becomes NBSPs (markdown strips it, or worse, turns
 *   4+ spaces into a code block).
 * - Runs of 2+ interior spaces are pinned with NBSPs (browsers collapse them).
 *
 * Structural whitespace is left alone: fenced code blocks, horizontal rules,
 * list/blockquote/heading markers, nested-list indentation, and trailing
 * spaces (markdown's hard-break syntax). Idempotent: already-processed text
 * passes through unchanged, so it is safe to apply both at save time and at
 * render time.
 */
export interface PreserveWhitespaceOptions {
  /**
   * "break" (default): a run of k blank lines renders as one paragraph break
   * plus k-1 visible empty paragraphs. Right for paragraph-styled documents
   * (share pages, Substack/Kit HTML), where paragraph margins already draw
   * the single-blank-line gap.
   * "literal": every one of the k blank lines becomes a visible empty
   * paragraph. Right for the piece read view, which renders paragraphs with
   * zero margins so it mirrors the textarea line for line.
   */
  blankLines?: "break" | "literal";
}

export function preserveWhitespace(
  markdown: string,
  options: PreserveWhitespaceOptions = {},
): string {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let inFence = false;
  let sawContent = false;
  let blanks = 0;
  let listContext = false;

  const literal = options.blankLines === "literal";

  const flushBlanks = () => {
    if (blanks === 0) return;
    if (!sawContent) {
      // Leading blank lines: markdown-it drops them outright, so every one
      // becomes a visible empty paragraph.
      for (let i = 0; i < blanks; i++) out.push(NBSP_ENTITY, "");
    } else {
      // Interior run of k blank lines. "break" mode: one is the paragraph
      // break itself, the other k-1 become visible empty paragraphs.
      // "literal" mode: all k become visible empty paragraphs.
      out.push("");
      for (let i = literal ? 0 : 1; i < blanks; i++) out.push(NBSP_ENTITY, "");
    }
    blanks = 0;
  };

  for (const line of lines) {
    if (inFence) {
      out.push(line);
      if (FENCE_LINE.test(line)) inFence = false;
      continue;
    }
    if (BLANK_LINE.test(line)) {
      blanks++;
      continue;
    }
    // The note editor's stored sentinel for an empty paragraph: rewrite it to
    // the entity form so markdown-it's inline trim can't erase it.
    if (NBSP_ONLY_LINE.test(line)) {
      flushBlanks();
      out.push(NBSP_ENTITY);
      sawContent = true;
      continue;
    }
    if (FENCE_LINE.test(line)) {
      flushBlanks();
      out.push(line);
      sawContent = true;
      inFence = true;
      continue;
    }

    const isListLine = LIST_MARKER.test(line.trimStart());
    if (isListLine) listContext = true;
    else if (!line.startsWith(" ")) listContext = false;

    flushBlanks();
    out.push(transformLine(line, listContext));
    sawContent = true;
  }
  // Trailing blank lines are dropped, matching what markdown would do anyway.
  return out.join("\n");
}
