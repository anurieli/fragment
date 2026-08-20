import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import {
  pasteEditorClipboard,
  writeEditorSelection,
} from "@/lib/editor/context-menu-clipboard";
import { latestNoteContentForExport } from "@/lib/export";

class TestClipboardItem {
  readonly data: Record<string, Blob>;
  readonly types: string[];

  constructor(data: Record<string, Blob>) {
    this.data = data;
    this.types = Object.keys(data);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("editor context-menu clipboard actions", () => {
  it("copies ProseMirror's rich serialization instead of flattening marks", async () => {
    vi.stubGlobal("ClipboardItem", TestClipboardItem);
    const dom = document.createElement("div");
    dom.innerHTML = '<p data-pm-slice="1 1 []"><strong>bold</strong></p>';
    const write = vi.fn().mockResolvedValue(undefined);
    const view = {
      state: { selection: { content: vi.fn(() => ({})) } },
      serializeForClipboard: vi.fn(() => ({ dom, text: "bold" })),
    } as unknown as EditorView;

    await writeEditorSelection(view, { write } as unknown as Clipboard);

    const item = write.mock.calls[0][0][0] as unknown as TestClipboardItem;
    expect(await item.data["text/html"].text()).toContain("<strong>bold</strong>");
    expect(await item.data["text/html"].text()).toContain("data-pm-slice");
    expect(await item.data["text/plain"].text()).toBe("bold");
  });

  it("pastes HTML through ProseMirror's clipboard parser", async () => {
    const pasteHTML = vi.fn(() => true);
    const pasteText = vi.fn(() => true);
    const view = { pasteHTML, pasteText } as unknown as EditorView;
    const clipboard = {
      read: vi.fn().mockResolvedValue([
        {
          types: ["text/html", "text/plain"],
          getType: vi.fn(async (type: string) => new Blob([
            type === "text/html" ? "<p><strong>bold</strong></p>" : "bold",
          ], { type })),
        },
      ]),
    } as unknown as Clipboard;

    await pasteEditorClipboard(view, clipboard);

    expect(pasteHTML).toHaveBeenCalledWith("<p><strong>bold</strong></p>");
    expect(pasteText).not.toHaveBeenCalled();
  });
});

describe("sidebar note export", () => {
  it("uses live editor content instead of the debounced saved snapshot", () => {
    expect(latestNoteContentForExport("note-1", "stale", "note-1", "latest")).toBe("latest");
    expect(latestNoteContentForExport("note-1", "saved", "note-2", "other")).toBe("saved");
  });
});