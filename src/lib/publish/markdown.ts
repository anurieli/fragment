import MarkdownIt from "markdown-it";

import { preserveWhitespace } from "./whitespace";

// `src/lib/export.ts` already ships markdown-flavored export (copyAsHtml,
// downloadAsHtml), but it works from a live Tiptap `Editor` instance
// (`editor.getHTML()`) rather than a plain markdown string, so it can't be
// called from a pure function here. Fragment's own editor uses
// `tiptap-markdown` (see src/components/editor/editor.tsx) to parse
// markdown, and that package's parser is itself built on `markdown-it`
// (node_modules/tiptap-markdown/src/parse/MarkdownParser.js) — so this reuses
// the same underlying markdown engine the app already ships, just without
// requiring a mounted editor/DOM. `markdown-it` is pinned in package.json.
//
// Kept deliberately conservative: html disabled (no raw HTML pass-through),
// linkify/typographer/breaks disabled (predictable, semantic output only).
const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: false,
});

/**
 * Converts a markdown string into clean, semantic HTML: headings, bold /
 * italic, links, ordered + unordered lists, blockquotes, and horizontal
 * rules. No raw HTML in the source is passed through (html: false).
 */
export function markdownToCleanHtml(markdown: string): string {
  return markdownRenderer.render(preserveWhitespace(markdown)).trim();
}

// Same engine, one difference: `breaks: true`. For the on-screen preview of a
// short-form piece, a single newline is a line the author put there on
// purpose — X and LinkedIn post it verbatim — so it has to survive as a <br>
// instead of collapsing into a space. The clipboard flavors keep breaks:false
// because pasting into Substack's editor wants real paragraphs.
const previewRenderer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
  breaks: true,
});

/**
 * Markdown → HTML for displaying a piece as formatted text (never for
 * publishing). Safe to inject: `html: false` escapes any raw HTML in the
 * source rather than passing it through, so an agent-pushed body can't smuggle
 * markup into the page.
 */
export function markdownToPreviewHtml(markdown: string): string {
  return previewRenderer.render(preserveWhitespace(markdown)).trim();
}

// Order matters: strip the widest-reaching syntax first (bold+italic before
// bold before italic) so a run like `***x***` doesn't leave stray asterisks
// behind after only the narrower pattern matches.
const HEADING_PREFIX = /^ {0,3}#{1,6}[ \t]+/gm;
const BLOCKQUOTE_PREFIX = /^ {0,3}>[ \t]?/gm;
const HR_LINE = /^ {0,3}(?:-[ \t]*){3,}$|^ {0,3}(?:\*[ \t]*){3,}$|^ {0,3}(?:_[ \t]*){3,}$/gm;
const ORDERED_LIST_PREFIX = /^ {0,3}\d+[.)][ \t]+/gm;
const BULLET_LIST_PREFIX = /^ {0,3}[-*+][ \t]+/gm;
const LINK_OR_IMAGE = /!?\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/g;
const BOLD_ITALIC = /(\*\*\*|___)([^*_]+?)\1/g;
const BOLD = /(\*\*|__)([^*_]+?)\1/g;
const ITALIC = /(\*|_)([^*_]+?)\1/g;
const INLINE_CODE = /`([^`]+)`/g;

/**
 * Best-effort markdown-to-plain-text conversion: strips the same syntax
 * `markdownToCleanHtml` renders (headings, bold/italic, links, lists,
 * blockquotes, hr) and returns the readable text underneath. This is an
 * approximation (regex-based, not a full markdown AST walk) — good enough
 * for a "plain flavor" clipboard fallback, not a byte-exact inverse of
 * `markdownToCleanHtml`.
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(HR_LINE, "")
    .replace(HEADING_PREFIX, "")
    .replace(BLOCKQUOTE_PREFIX, "")
    .replace(ORDERED_LIST_PREFIX, "")
    .replace(BULLET_LIST_PREFIX, "")
    .replace(LINK_OR_IMAGE, "$1")
    .replace(BOLD_ITALIC, "$2")
    .replace(BOLD, "$2")
    .replace(ITALIC, "$2")
    .replace(INLINE_CODE, "$1");
}
