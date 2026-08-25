import { EditorState } from "@tiptap/pm/state";
import type { Editor as TiptapEditor } from "@tiptap/core";

/**
 * Throw away the undo/redo stack, keeping the document and the selection.
 *
 * One Tiptap instance serves every fragment, so `setContent` on a fragment
 * switch was landing in the *shared* history as an ordinary full-document
 * replacement. Undo then walked backwards out of the fragment on screen and
 * into the one that had been open before it, and because that undo is a real
 * user transaction, the editor's onUpdate saved the previous fragment's body
 * over the current one. Redo did the same thing forwards. The article being
 * edited simply became a different article, and the original text was gone.
 *
 * prosemirror-history exposes no reset, and marking the swap `addToHistory:
 * false` is not enough on its own: the old document's events survive with
 * their steps remapped through the replacement, so undo stops corrupting the
 * draft but also stops doing anything, which is its own bug. Recreating the
 * state is the way to drop plugin state, and a history stack belonging to
 * another document deserves dropping. The transient decoration plugins (the
 * comment jump, the insert highlight) reset with it, which is correct: they
 * hold positions in the document being replaced.
 */
export function clearEditorHistory(editor: TiptapEditor) {
  const { view } = editor;
  view.updateState(
    EditorState.create({
      doc: view.state.doc,
      plugins: view.state.plugins,
      selection: view.state.selection,
      storedMarks: view.state.storedMarks,
    }),
  );
}
