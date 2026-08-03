import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import {
  moveEditorSelection,
  moveTextareaSelection,
  rangeForOffsets,
  selectionDragDestination,
  textareaSelectionRange,
} from "@/lib/textarea-selection";
import { highlightMarkdown } from "@/lib/markdown-highlight";

/**
 * The mirror is only a usable ruler for a textarea's selection while its text
 * content matches the textarea's value character for character — the same
 * invariant highlightMarkdown promises. These cover the offset -> DOM mapping
 * across the spans it emits; the pixel hit test itself needs real layout, so
 * it belongs to the browser, not here.
 */
function mirrorFor(markdown: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = highlightMarkdown(markdown);
  return el;
}

describe("rangeForOffsets", () => {
  it("maps offsets that land inside one text node", () => {
    const el = mirrorFor("plain sentence here");
    const range = rangeForOffsets(el, 6, 14);
    expect(range?.toString()).toBe("sentence");
  });

  it("maps offsets that span several styled spans", () => {
    const markdown = "**bold** and *italic* together";
    const el = mirrorFor(markdown);
    expect(el.textContent).toBe(markdown);

    const range = rangeForOffsets(el, 0, markdown.length);
    expect(range?.toString()).toBe(markdown);
  });

  it("maps a selection that crosses a line break", () => {
    const markdown = "# Heading\n\nA line of prose";
    const el = mirrorFor(markdown);
    const start = markdown.indexOf("Heading");
    const end = markdown.indexOf("prose") + "prose".length;

    expect(rangeForOffsets(el, start, end)?.toString()).toBe(
      markdown.slice(start, end),
    );
  });

  it("returns null for an empty or backwards range", () => {
    const el = mirrorFor("some text");
    expect(rangeForOffsets(el, 4, 4)).toBeNull();
    expect(rangeForOffsets(el, 6, 2)).toBeNull();
  });

  it("returns null when the offsets run past the text", () => {
    const el = mirrorFor("short");
    expect(rangeForOffsets(el, 2, 99)).toBeNull();
  });
});

describe("moving a dragged selection", () => {
  it("moves exact textarea text backward and reports its new selection", () => {
    expect(moveTextareaSelection("alpha beta gamma", "alpha beta gamma", 6, 11, 0)).toEqual({
      value: "beta alpha gamma",
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it("adjusts a forward textarea drop after removing the source", () => {
    expect(moveTextareaSelection("alpha beta gamma", "alpha beta gamma", 0, 6, 11)).toEqual({
      value: "beta alpha gamma",
      selectionStart: 5,
      selectionEnd: 11,
    });
  });

  it("does nothing when textarea text is dropped inside its original selection", () => {
    expect(moveTextareaSelection("alpha beta gamma", "alpha beta gamma", 6, 10, 8)).toBeNull();
  });

  it("maps normalized textarea offsets back to CRLF source bytes", () => {
    expect(textareaSelectionRange("alpha\r\nbeta gamma", 6, 10)).toEqual({
      start: 7,
      end: 11,
    });
    expect(
      moveTextareaSelection("alpha\r\nbeta gamma", "alpha\r\nbeta gamma", 6, 10, 0),
    ).toEqual({
      value: "betaalpha\r\n gamma",
      selectionStart: 0,
      selectionEnd: 4,
    });
  });

  it("does not overwrite a body that changed after the drag started", () => {
    expect(
      moveTextareaSelection("new alpha beta gamma", "alpha beta gamma", 6, 10, 0),
    ).toBeNull();
  });

  it("moves a ProseMirror slice with its formatting intact", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "inline*", group: "block" },
        text: { group: "inline" },
      },
      marks: { strong: {} },
    });
    const strong = schema.marks.strong.create();
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("alpha", [strong]),
        schema.text(" beta gamma"),
      ]),
    ]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, 7),
    });

    const tr = moveEditorSelection(state, { from: 1, to: 7 }, 12);
    expect(tr?.doc.textContent).toBe("beta alpha gamma");
    expect(tr?.doc.textBetween(tr.selection.from, tr.selection.to)).toBe("alpha ");
    expect(tr?.getMeta("uiEvent")).toBe("drop");

    const markedText: string[] = [];
    tr?.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type === schema.marks.strong)) {
        markedText.push(node.text ?? "");
      }
    });
    expect(markedText.join("")).toBe("alpha");
  });

  it("does not move an editor selection onto itself", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: {},
      },
    });
    const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("alpha beta"))]);
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1, 6) });

    expect(moveEditorSelection(state, { from: 1, to: 6 }, 4)).toBeNull();
  });

  it("preserves complete block nodes when moving across paragraphs", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: {},
      },
    });
    const first = schema.node("paragraph", null, schema.text("alpha"));
    const second = schema.node("paragraph", null, schema.text("beta"));
    const doc = schema.node("doc", null, [first, second]);
    const state = EditorState.create({ doc });

    const tr = moveEditorSelection(state, { from: 0, to: first.nodeSize }, doc.content.size);
    expect(tr?.doc.toJSON()).toEqual(
      schema.node("doc", null, [second, first]).toJSON(),
    );
    expect(tr?.getMeta("uiEvent")).toBe("drop");
  });

  it("does not apply positions captured from an older editor document", () => {
    const schema = new Schema({
      nodes: {
        doc: { content: "paragraph+" },
        paragraph: { content: "text*" },
        text: {},
      },
    });
    const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("alpha beta"))]);
    const state = EditorState.create({ doc });
    const changedState = state.apply(state.tr.insertText("new ", 1));

    expect(moveEditorSelection(changedState, { from: 1, to: 6 }, 11, doc)).toBeNull();
  });
});

describe("selection drag routing", () => {
  it("routes nested Snip Bar and source-editor targets before outside targets", () => {
    const source = document.createElement("div");
    const sourceChild = source.appendChild(document.createElement("span"));
    const snipBar = document.createElement("div");
    const snipChild = snipBar.appendChild(document.createElement("span"));

    expect(selectionDragDestination(source, snipBar, snipChild)).toBe("snip-bar");
    expect(selectionDragDestination(source, snipBar, sourceChild)).toBe("source");
    expect(selectionDragDestination(source, snipBar, document.createElement("div"))).toBe("outside");
  });
});
