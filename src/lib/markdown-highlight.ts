// Live markdown highlighting for the short-form piece editor.
//
// This is NOT a renderer. It takes raw markdown and returns HTML whose text
// content is *character-for-character identical* to the input — every marker,
// every space, every newline still there — with styling spans wrapped around
// the interesting bits. That invariant is the whole point: the highlighted
// HTML is painted behind a transparent textarea, so the two have to lay out
// identically or the caret drifts away from the glyphs under it.
//
// Two rules follow from that, and both are load-bearing:
//   1. Never add, drop, or reorder a character. `stripTags(highlight(x)) === x`.
//   2. Every class this emits may only use metric-preserving CSS — color,
//      opacity, background, text-decoration, text-shadow. No font-size, no
//      font-weight, no font-family, no letter-spacing. A bold span that is
//      genuinely bold is wider than the plain text the textarea laid out
//      underneath it, and the caret lands in the wrong place. Faux weight
//      comes from text-shadow instead (see .md-strong in globals.css).
//
// For actual rendered output (reading a piece, publishing it) see
// src/lib/publish/markdown.ts.

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function span(className: string, text: string): string {
  return text ? `<span class="${className}">${escapeHtml(text)}</span>` : "";
}

/** Marker punctuation (`**`, `##`, `>`, bullets) — kept, but dimmed back. */
function mark(text: string): string {
  return span("md-mark", text);
}

// Inline constructs, longest-first so `***` beats `**` beats `*`. Named
// groups (and named backreferences for the closing marker) rather than
// numbered ones: the branches share one alternation, and numbered
// backreferences silently point at the wrong branch's group the moment
// anything is inserted above them.
const INLINE_PATTERN = new RegExp(
  [
    "(?<codeOpen>`+)(?<codeBody>[^`]*?)\\k<codeOpen>",
    "(?<biOpen>\\*\\*\\*|___)(?<biBody>[\\s\\S]+?)\\k<biOpen>",
    "(?<bOpen>\\*\\*|__)(?<bBody>[\\s\\S]+?)\\k<bOpen>",
    "(?<iOpen>\\*|_)(?<iBody>[^\\s*_][\\s\\S]*?)\\k<iOpen>",
    "(?<sOpen>~~)(?<sBody>[\\s\\S]+?)~~",
    "(?<lOpen>!?\\[)(?<lText>[^\\]\\n]*)(?<lMid>\\]\\()(?<lUrl>[^)\\n]*)(?<lClose>\\))",
  ].join("|"),
  "g",
);

/** Styles inline constructs within a single line's prose. Each branch emits
 * open marker + styled content + close marker, which reassembles the matched
 * text exactly (the closing marker is a backreference, so it's identical to
 * the opening one). */
function highlightInline(text: string): string {
  let out = "";
  let cursor = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    const g = match.groups ?? {};
    out += escapeHtml(text.slice(cursor, index));
    cursor = index + match[0].length;

    if (g.codeOpen !== undefined) {
      out += span("md-code", `${g.codeOpen}${g.codeBody}${g.codeOpen}`);
    } else if (g.biOpen !== undefined) {
      out += mark(g.biOpen) + span("md-strong md-em", g.biBody) + mark(g.biOpen);
    } else if (g.bOpen !== undefined) {
      out += mark(g.bOpen) + span("md-strong", g.bBody) + mark(g.bOpen);
    } else if (g.iOpen !== undefined) {
      out += mark(g.iOpen) + span("md-em", g.iBody) + mark(g.iOpen);
    } else if (g.sOpen !== undefined) {
      out += mark(g.sOpen) + span("md-strike", g.sBody) + mark("~~");
    } else if (g.lOpen !== undefined) {
      out +=
        mark(g.lOpen) +
        span("md-link", g.lText) +
        mark(g.lMid) +
        span("md-url", g.lUrl) +
        mark(g.lClose);
    }
  }

  out += escapeHtml(text.slice(cursor));
  return out;
}

const HEADING = /^(\s*#{1,6}[ \t]+)(.*)$/;
const QUOTE = /^(\s*>[ \t]?)(.*)$/;
const LIST = /^(\s*(?:[-*+]|\d+[.)])[ \t]+)(.*)$/;
const RULE = /^(\s*(?:-{3,}|\*{3,}|_{3,})\s*)$/;

/** Styles one line: its block marker, then whatever prose follows it. */
function highlightLine(line: string): string {
  if (line.length === 0) return "";

  const rule = RULE.exec(line);
  if (rule) return mark(rule[1]);

  const heading = HEADING.exec(line);
  if (heading) return mark(heading[1]) + span("md-heading", heading[2]);

  const quote = QUOTE.exec(line);
  if (quote) return mark(quote[1]) + span("md-quote", quote[2]);

  const list = LIST.exec(line);
  if (list) return mark(list[1]) + highlightInline(list[2]);

  return highlightInline(line);
}

/**
 * Markdown in, styled HTML out, with the source text preserved exactly.
 * Newlines are emitted as literal newlines (never `<br>`) — the mirror element
 * uses `white-space: pre-wrap`, matching the textarea's own wrapping.
 */
export function highlightMarkdown(markdown: string): string {
  return markdown.split("\n").map(highlightLine).join("\n");
}
