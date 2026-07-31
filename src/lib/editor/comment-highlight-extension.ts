import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * A decoration-only highlight for jumping to a reviewer's comment from the
 * ReviewPanel (ARI-245). Deliberately not a document mark: clicking a comment
 * should point at where it is, not edit the note. The mark stays until the
 * panel clears it (another comment clicked, or the panel closes) rather than
 * vanishing the instant the user's mouse moves, which is what a plain
 * `setTextSelection` does the moment focus shifts.
 */

const pluginKey = new PluginKey("commentHighlight");

export interface CommentHighlightRange {
  from: number;
  to: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    commentHighlight: {
      setCommentHighlight: (range: CommentHighlightRange) => ReturnType;
      clearCommentHighlight: () => ReturnType;
    };
  }
}

export const CommentHighlight = Extension.create({
  name: "commentHighlight",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, old) {
            const meta = tr.getMeta(pluginKey) as CommentHighlightRange | null | undefined;
            if (meta === null) return DecorationSet.empty;
            if (meta) {
              return DecorationSet.create(tr.doc, [
                Decoration.inline(meta.from, meta.to, { class: "comment-jump-highlight" }),
              ]);
            }
            return old.map(tr.mapping, tr.doc);
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
      setCommentHighlight:
        (range: CommentHighlightRange) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(pluginKey, range));
          return true;
        },
      clearCommentHighlight:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(pluginKey, null));
          return true;
        },
    };
  },
});
