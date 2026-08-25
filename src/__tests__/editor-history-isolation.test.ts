import { describe, it, expect, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { undoDepth, redoDepth } from "@tiptap/pm/history";

import { clearEditorHistory } from "@/lib/editor/history";

/**
 * The bug this guards is the worst kind Fragment can have: one article turning
 * into another one, silently, with the original text unrecoverable.
 *
 * A single Tiptap instance serves every fragment. Opening a fragment calls
 * setContent, which is an ordinary full-document replacement as far as
 * prosemirror-history is concerned. So the undo stack spanned fragments:
 * ⌘Z inside "AI is a Change Management Problem" undid the *fragment switch*
 * and put the body of "Old School Systems, Futuristic Concepts" on screen,
 * where the editor's onUpdate dutifully saved it over the open draft.
 */

const editors: Editor[] = [];

function makeEditor(content = "") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const editor = new Editor({ element: el, extensions: [StarterKit], content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

const ARTICLE_A = "<p>Old School Systems, Futuristic Concepts</p>";
const ARTICLE_B = "<p>AI is a Change Management Problem</p>";

describe("editor undo history across fragments", () => {
  it("undo reaches into the previously open fragment when history is not cleared", () => {
    // The regression itself, asserted so the fix is provably a fix and not a
    // guess about what Tiptap does.
    const editor = makeEditor(ARTICLE_A);
    editor.commands.setContent(ARTICLE_B);
    expect(editor.getHTML()).toContain("Change Management");

    editor.commands.undo();
    expect(editor.getHTML()).toContain("Old School Systems");
  });

  it("clearEditorHistory leaves nothing to undo into", () => {
    const editor = makeEditor(ARTICLE_A);
    editor.commands.setContent(ARTICLE_B);
    clearEditorHistory(editor);

    expect(undoDepth(editor.state)).toBe(0);
    expect(editor.can().undo()).toBe(false);

    editor.commands.undo();
    expect(editor.getHTML()).toContain("Change Management");
    expect(editor.getHTML()).not.toContain("Old School Systems");
  });

  it("keeps the document, and undo works normally on edits made afterwards", () => {
    const editor = makeEditor(ARTICLE_A);
    editor.commands.setContent(ARTICLE_B);
    clearEditorHistory(editor);

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.insertContent(" Wearing a Technology Costume");
    expect(editor.getHTML()).toContain("Technology Costume");

    editor.commands.undo();
    expect(editor.getHTML()).toContain("Change Management");
    expect(editor.getHTML()).not.toContain("Technology Costume");

    // And redo, the keystroke that first surfaced this, stays inside the
    // fragment instead of walking forwards into the other document.
    expect(redoDepth(editor.state)).toBe(1);
    editor.commands.redo();
    expect(editor.getHTML()).toContain("Technology Costume");
    expect(editor.getHTML()).not.toContain("Old School Systems");
  });

  it("survives a repeat clear on an untouched document", () => {
    const editor = makeEditor(ARTICLE_B);
    clearEditorHistory(editor);
    clearEditorHistory(editor);
    expect(editor.getHTML()).toContain("Change Management");
    expect(undoDepth(editor.state)).toBe(0);
  });
});
