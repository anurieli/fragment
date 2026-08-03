import type { EditorView } from "@tiptap/pm/view";

/**
 * Copy the current ProseMirror selection using the editor's own clipboard
 * serializer. Besides preserving marks and block structure, this keeps the
 * data-pm-slice metadata ProseMirror uses for lossless in-editor pastes.
 */
export async function writeEditorSelection(
  view: EditorView,
  clipboard: Clipboard = navigator.clipboard,
): Promise<void> {
  const { dom, text } = view.serializeForClipboard(view.state.selection.content());

  if (typeof clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
    await clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([dom.innerHTML], { type: "text/html" }),
        "text/plain": new Blob([text], { type: "text/plain" }),
      }),
    ]);
    return;
  }

  await clipboard.writeText(text);
}

/** Read rich clipboard data when available and feed it through ProseMirror's
 * native paste parser. Plain text remains the fallback for restricted WebViews. */
export async function pasteEditorClipboard(
  view: EditorView,
  clipboard: Clipboard = navigator.clipboard,
): Promise<boolean> {
  if (typeof clipboard.read === "function") {
    const items = await clipboard.read();
    for (const item of items) {
      if (item.types.includes("text/html")) {
        const html = await (await item.getType("text/html")).text();
        if (html) return view.pasteHTML(html);
      }
    }
    for (const item of items) {
      if (item.types.includes("text/plain")) {
        const text = await (await item.getType("text/plain")).text();
        if (text) return view.pasteText(text);
      }
    }
    return false;
  }

  const text = await clipboard.readText();
  return text ? view.pasteText(text) : false;
}