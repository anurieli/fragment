import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";

import { NBSP, NBSP_ENTITY, hardenSpaces } from "@/lib/publish/whitespace";

/**
 * Markdown serialization overrides that stop the note editor from throwing
 * away the author's spacing on every save.
 *
 * prosemirror-markdown writes block separators through `flushClose`, which
 * caps the run at two newlines no matter how many empty paragraphs sit
 * between two blocks. So a note with three blank lines and a note with none
 * serialize to the identical `a\n\nb`: the blank lines are gone before
 * anything downstream can preserve them, which is why they vanished as soon
 * as a note was closed and reopened. (`preserveEmptyParagraphs` in
 * lib/publish/whitespace.ts was written for a `\n{3,}` run that this
 * serializer never actually emits.)
 *
 * The fix is to give an empty paragraph real content on the way out: a NBSP,
 * which markdown-it parses back as a genuine paragraph. `cleanupNbspParagraphs`
 * in components/editor/editor.tsx strips that NBSP right after parsing, so the
 * editor still holds a truly empty paragraph and the cycle is stable across
 * any number of saves.
 *
 * Runs of spaces get the same treatment for the same reason: markdown-it
 * collapses them on re-parse, so they are pinned with NBSPs at serialize time.
 * Inline code is untouched, because prosemirror-markdown renders code-marked
 * text without consulting this serializer at all.
 */

// tiptap-markdown types these hooks loosely (`MarkdownNodeSpec` is JSDoc-only
// in the shipped package), so the state and node params are structural.
/* eslint-disable @typescript-eslint/no-explicit-any */

/** tiptap-markdown's own text serializer escapes these before writing. */
function escapeHtmlBrackets(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const WhitespaceParagraph = Paragraph.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          if (node.content.size === 0) {
            state.write(NBSP);
            state.closeBlock(node);
            return;
          }
          const start = state.out.length;
          state.renderInline(node);
          // markdown-it trims each paragraph's source with String.trim(), which
          // removes U+00A0 as well as ASCII space, so a leading indent has to
          // leave as `&nbsp;` entities: ASCII in the source (nothing to trim),
          // decoded back to real NBSPs when the note is parsed again.
          // The slice opens with the block separator `renderInline` flushed, so
          // the indent to patch is whatever follows those newlines.
          const rendered = state.out.slice(start);
          const patched = rendered.replace(
            /^(\n*)([ \u00A0]+)/,
            (_full: string, newlines: string, run: string) =>
              newlines + NBSP_ENTITY.repeat(run.length),
          );
          if (patched !== rendered) {
            state.out = state.out.slice(0, start) + patched;
          }
          state.closeBlock(node);
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});

export const WhitespaceText = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.text(hardenSpaces(escapeHtmlBrackets(node.text ?? "")));
        },
        parse: {
          // handled by markdown-it
        },
      },
    };
  },
});
