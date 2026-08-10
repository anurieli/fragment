import { describe, it, expect } from "vitest";
import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { DecorationSet } from "prosemirror-view";

import {
  applyInsertHighlightMeta,
  type InsertHighlightMeta,
} from "@/lib/editor/insert-highlight-extension";

/** A three-paragraph doc, long enough to carve a multi-block range out of. */
function makeState() {
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [schema.text("first paragraph")]),
    schema.node("paragraph", null, [schema.text("second paragraph")]),
    schema.node("paragraph", null, [schema.text("third paragraph")]),
  ]);
  return EditorState.create({ doc, schema });
}

/** Reads back the {from,to} pairs a decoration set covers, for assertions
 * that don't care about internal DecorationSet representation. */
function ranges(set: DecorationSet) {
  return set.find().map((d) => ({ from: d.from, to: d.to }));
}

describe("applyInsertHighlightMeta", () => {
  it("adds nothing and passes the set through unchanged when meta is absent", () => {
    const state = makeState();
    const tr = state.tr;
    const result = applyInsertHighlightMeta(DecorationSet.empty, tr, undefined);
    expect(ranges(result)).toEqual([]);
  });

  it("adds a decoration spanning the given range on 'add'", () => {
    const state = makeState();
    const tr = state.tr;
    const meta: InsertHighlightMeta = { type: "add", id: "a", from: 1, to: 6 };
    const result = applyInsertHighlightMeta(DecorationSet.empty, tr, meta);
    expect(ranges(result)).toEqual([{ from: 1, to: 6 }]);
  });

  it("removes only the decoration matching the given id", () => {
    const state = makeState();
    let set = DecorationSet.empty;
    set = applyInsertHighlightMeta(set, state.tr, { type: "add", id: "a", from: 1, to: 6 });
    set = applyInsertHighlightMeta(set, state.tr, { type: "add", id: "b", from: 10, to: 15 });
    expect(ranges(set)).toHaveLength(2);

    set = applyInsertHighlightMeta(set, state.tr, { type: "remove", id: "a" });
    expect(ranges(set)).toEqual([{ from: 10, to: 15 }]);
  });

  it("is a no-op removing an id that was never added", () => {
    const state = makeState();
    let set = DecorationSet.empty;
    set = applyInsertHighlightMeta(set, state.tr, { type: "add", id: "a", from: 1, to: 6 });
    set = applyInsertHighlightMeta(set, state.tr, { type: "remove", id: "nonexistent" });
    expect(ranges(set)).toEqual([{ from: 1, to: 6 }]);
  });

  it("remaps surviving decorations through later document edits", () => {
    const state = makeState();
    let set = DecorationSet.empty;
    set = applyInsertHighlightMeta(set, state.tr, { type: "add", id: "a", from: 20, to: 25 });

    // Insert text before the highlighted range; its positions should shift.
    const insertTr = state.tr.insertText("XXXXX", 1);
    set = applyInsertHighlightMeta(set, insertTr, undefined);
    expect(ranges(set)).toEqual([{ from: 25, to: 30 }]);
  });

  it("supports several live ids at once, each removable independently", () => {
    const state = makeState();
    let set = DecorationSet.empty;
    set = applyInsertHighlightMeta(set, state.tr, { type: "add", id: "a", from: 1, to: 6 });
    set = applyInsertHighlightMeta(set, state.tr, { type: "add", id: "b", from: 10, to: 15 });
    set = applyInsertHighlightMeta(set, state.tr, { type: "add", id: "c", from: 20, to: 25 });

    set = applyInsertHighlightMeta(set, state.tr, { type: "remove", id: "b" });
    expect(ranges(set).sort((x, y) => x.from - y.from)).toEqual([
      { from: 1, to: 6 },
      { from: 20, to: 25 },
    ]);
  });
});
