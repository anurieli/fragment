import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

import { WhitespaceParagraph, WhitespaceText } from "@/lib/editor/whitespace-markdown";

const NBSP = "\u00A0";

/**
 * Mirrors the note editor's extension set (src/components/editor/editor.tsx).
 * The regression these tests guard is the save/reopen cycle: serialize to
 * markdown, store, parse it back, and check the author's spacing is still
 * there. Before the WhitespaceParagraph/WhitespaceText serializers, every
 * empty paragraph was dropped by prosemirror-markdown's block separator (which
 * caps a run at two newlines), so closing and reopening a note flattened all
 * blank lines.
 */
function makeEditor() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [
      StarterKit.configure({ paragraph: false, text: false }),
      WhitespaceParagraph,
      WhitespaceText,
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
    ],
    content: "",
  });
}

function getMarkdown(ed: Editor): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ed.storage as any).markdown.getMarkdown() as string;
}

function paragraphs(ed: Editor) {
  const out: string[] = [];
  ed.state.doc.descendants((node) => {
    if (node.type.name === "paragraph") out.push(node.textContent);
  });
  return out;
}

/** One save-and-reopen cycle: what the note editor does on every note switch. */
function reopen(ed: Editor): string {
  const saved = getMarkdown(ed);
  ed.commands.setContent(saved);
  return saved;
}

describe("note editor markdown round trip", () => {
  it("keeps every empty paragraph between two blocks", () => {
    for (const blanks of [1, 2, 3, 5]) {
      const ed = makeEditor();
      ed.commands.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "a" }] },
          ...Array.from({ length: blanks }, () => ({ type: "paragraph" })),
          { type: "paragraph", content: [{ type: "text", text: "b" }] },
        ],
      });

      reopen(ed);

      const empties = paragraphs(ed).filter((t) => t === "").length;
      expect(empties, `${blanks} blank lines should survive reopening`).toBe(blanks);
    }
  });

  it("serializes an empty paragraph as a NBSP line rather than dropping it", () => {
    const ed = makeEditor();
    ed.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });
    expect(getMarkdown(ed)).toBe(`a\n\n${NBSP}\n\nb`);
  });

  it("keeps runs of spaces inside a line", () => {
    const ed = makeEditor();
    ed.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A   B" }] }],
    });

    reopen(ed);

    // Width is preserved: NBSPs plus one ordinary space, so the line can wrap.
    expect(paragraphs(ed)[0]).toBe(`A${NBSP}${NBSP} B`);
    expect(paragraphs(ed)[0]).toHaveLength(5);
  });

  it("keeps leading indentation instead of stripping it or making a code block", () => {
    const ed = makeEditor();
    ed.commands.setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "    indented" }] }],
    });

    const saved = reopen(ed);

    // markdown-it trims paragraph source with String.trim(), which removes
    // U+00A0 as well, so the indent has to travel as entities.
    expect(saved).toContain("&nbsp;");
    expect(paragraphs(ed)[0]).toBe(`${NBSP.repeat(4)}indented`);
  });

  it("is stable across repeated save/reopen cycles", () => {
    const ed = makeEditor();
    ed.commands.setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "para one" }] },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "gap   inside" }] },
        { type: "paragraph", content: [{ type: "text", text: "    indented" }] },
      ],
    });

    const first = reopen(ed);
    const second = reopen(ed);
    const third = reopen(ed);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(paragraphs(ed).filter((t) => t === "")).toHaveLength(3);
  });

  it("leaves structural markdown byte-identical", () => {
    const ed = makeEditor();
    const src = [
      "# Title",
      "",
      "## Sub",
      "",
      "- one",
      "- two",
      "  - nested",
      "",
      "1. first",
      "2. second",
      "",
      "> quote",
      "",
      "```js",
      "code  here",
      "  indented",
      "```",
      "",
      "---",
      "",
      "**bold** *em* [link](https://x.com) `inline`",
    ].join("\n");

    ed.commands.setContent(src);

    // Code blocks keep their own spacing, list nesting keeps real indentation,
    // and inline code is never NBSP-padded.
    expect(getMarkdown(ed)).toBe(src);
  });
});
