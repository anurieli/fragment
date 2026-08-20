import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * A decoration-only highlight for text that just landed from a drag out of
 * the helper bar (a snip or one of the idea's other pieces). Structured after
 * comment-highlight-extension.ts: never a mark, because a mark would ride
 * along in the document and get written into saved markdown. This is a spot
 * light on the drop, not part of the piece, so the plugin state is the only
 * place it lives, and the caller (editor.tsx) times its own removal. The
 * plugin just knows how to add and remove ranges by id.
 *
 * Multiple ids can be live at once (two drops in quick succession), which is
 * why state is a DecorationSet keyed by id rather than a single range like
 * the comment jump highlight.
 */

const pluginKey = new PluginKey<DecorationSet>("insertHighlight");

export type InsertHighlightMeta =
  | { type: "add"; id: string; from: number; to: number }
  | { type: "remove"; id: string };

/** Pure enough to unit test without a running editor: given the previous
 * decoration set, the transaction that carries it, and the meta describing
 * what changed, returns the next set. */
export function applyInsertHighlightMeta(
  old: DecorationSet,
  tr: Transaction,
  meta: InsertHighlightMeta | undefined,
): DecorationSet {
  const mapped = old.map(tr.mapping, tr.doc);
  if (!meta) return mapped;

  if (meta.type === "add") {
    const decoration = Decoration.inline(
      meta.from,
      meta.to,
      { class: "insert-highlight-overlay" },
      { insertHighlightId: meta.id },
    );
    return mapped.add(tr.doc, [decoration]);
  }

  // "remove": DecorationSet has no removeByAttr, so find-then-remove.
  const toRemove = mapped.find(
    undefined,
    undefined,
    (spec) => spec.insertHighlightId === meta.id,
  );
  return mapped.remove(toRemove);
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    insertHighlight: {
      addInsertHighlight: (range: { id: string; from: number; to: number }) => ReturnType;
      removeInsertHighlight: (id: string) => ReturnType;
    };
  }
}

export const InsertHighlight = Extension.create({
  name: "insertHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(pluginKey) as InsertHighlightMeta | undefined;
            return applyInsertHighlightMeta(old, tr, meta);
          },
        },
        props: {
          decorations(state) {
            return pluginKey.getState(state);
          },
        },
      }),
    ];
  },

  addCommands() {
    return {
      addInsertHighlight:
        (range: { id: string; from: number; to: number }) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(pluginKey, { type: "add", ...range }));
          return true;
        },
      removeInsertHighlight:
        (id: string) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(pluginKey, { type: "remove", id }));
          return true;
        },
    };
  },
});
