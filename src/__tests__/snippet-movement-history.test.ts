import { describe, expect, it } from "vitest";
import { closeHistory, history, redo, undo, undoDepth } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";
import type { Snippet } from "@/lib/types";
import {
  addSnippetMovementToHistory,
  snippetMovementEffects,
} from "@/lib/editor/snippet-movement-history";

function snippet(id: string): Snippet {
  return {
    id,
    noteId: "note-1",
    content: id,
    label: null,
    labelStatus: "idle",
    createdAt: 1,
    order: 0,
  };
}

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: { inline: true },
  },
});

describe("snippet movement history", () => {
  it("carries the persisted half through undo and redo after editor history is full", () => {
    const moved = snippet("moved");
    let state = EditorState.create({
      schema,
      doc: schema.node("doc", null, [schema.node("paragraph", null, schema.text("move me"))]),
      plugins: [history({ depth: 2, newGroupDelay: 0 })],
    });

    for (let i = 0; i < 30; i += 1) {
      const transaction = closeHistory(
        state.tr.insertText("x", state.doc.content.size - 1),
      );
      state = state.apply(transaction);
    }
    expect(undoDepth(state)).toBeLessThan(30);

    const beforeMove = state.doc.textContent;
    const movement = state.tr.delete(1, 5);
    addSnippetMovementToHistory(movement, {
      direction: "to-snip-bar",
      snippet: moved,
    });
    state = state.apply(movement);
    expect(state.doc.textContent).not.toBe(beforeMove);

    let effects: ReturnType<typeof snippetMovementEffects> = [];
    const dispatch = (transaction: Transaction) => {
      effects = snippetMovementEffects(transaction.steps);
      state = state.apply(transaction);
    };

    expect(undo(state, dispatch)).toBe(true);
    expect(state.doc.textContent).toBe(beforeMove);
    expect(effects).toEqual([{ action: "remove", snippet: moved }]);

    expect(redo(state, dispatch)).toBe(true);
    expect(state.doc.textContent).not.toBe(beforeMove);
    expect(effects).toEqual([{ action: "restore", snippet: moved }]);
  });

  it("reverses a Snip-Bar-to-editor movement symmetrically", () => {
    const moved = snippet("returned");
    const transaction = EditorState.create({ schema }).tr;
    addSnippetMovementToHistory(transaction, {
      direction: "to-editor",
      snippet: moved,
    });

    const [movementStep] = transaction.steps;
    expect(snippetMovementEffects([movementStep.invert(transaction.before)])).toEqual([
      { action: "restore", snippet: moved },
    ]);
    expect(snippetMovementEffects([movementStep])).toEqual([
      { action: "remove", snippet: moved },
    ]);
  });
});
