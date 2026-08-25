import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

/**
 * In the hosted build this guard caught a real recurrence: the fix shipped for
 * one editor and the same data loss happened again within the hour, because
 * there was a second Tiptap instance nobody had accounted for.
 *
 * A source-level guard rather than a behavioural one, deliberately. What has
 * to be true is not "this file behaves" but "every editor in the app scopes
 * its history", and the only way another one gets added without anybody
 * noticing is if nothing is watching for it.
 */
function editorSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      out.push(...editorSourceFiles(full));
    } else if (name.endsWith(".tsx") || name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("every Tiptap editor in the app scopes its own history", () => {
  it("each useEditor call site clears the history when it swaps documents", () => {
    const offenders: string[] = [];
    for (const file of editorSourceFiles(join(process.cwd(), "src"))) {
      const source = readFileSync(file, "utf8");
      if (!source.includes("useEditor(")) continue;
      if (!source.includes("clearEditorHistory")) {
        offenders.push(file.replace(process.cwd() + "/", ""));
      }
    }
    expect(offenders).toEqual([]);
  });
});
