import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InlineEditMenu } from "@/components/editor/inline-edit-menu";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("InlineEditMenu", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it("restores a focused custom edit when its selection scrolls out and back into view", async () => {
    vi.stubGlobal("ResizeObserver", ResizeObserverMock);

    const listeners = new Map<string, Set<() => void>>();
    const editorScroll = document.createElement("div");
    editorScroll.className = "overflow-y-auto";
    editorScroll.scrollTop = 600;
    editorScroll.getBoundingClientRect = () => ({
      top: 100,
      right: 900,
      bottom: 700,
      left: 100,
      width: 800,
      height: 600,
      x: 100,
      y: 100,
      toJSON: () => ({}),
    });

    const editorDom = document.createElement("div");
    const menuMount = document.createElement("div");
    editorScroll.append(editorDom, menuMount);
    document.body.appendChild(editorScroll);

    let selectionOffscreen = false;
    const fakeEditor = {
      isFocused: true,
      state: { selection: { from: 1, to: 5 } },
      view: {
        dom: editorDom,
        coordsAtPos: (position: number) => selectionOffscreen
          ? { top: 20, right: 500, bottom: 40, left: 400 }
          : position === 1
            ? { top: 300, right: 410, bottom: 320, left: 400 }
            : { top: 300, right: 500, bottom: 320, left: 490 },
      },
      on: (event: string, callback: () => void) => {
        const callbacks = listeners.get(event) ?? new Set();
        callbacks.add(callback);
        listeners.set(event, callbacks);
      },
      off: (event: string, callback: () => void) => {
        listeners.get(event)?.delete(callback);
      },
    };

    render(
      <InlineEditMenu
        editor={fakeEditor as unknown as TiptapEditor}
        onSnip={vi.fn()}
        onEdit={vi.fn().mockResolvedValue(null)}
      />,
      { container: menuMount },
    );

    act(() => {
      listeners.get("selectionUpdate")?.forEach((callback) => callback());
    });
    fireEvent.click(screen.getByTitle("Custom edit"));

    const customInput = await screen.findByPlaceholderText("Tell me how to edit this…");
    fireEvent.change(customInput, { target: { value: "Keep this direct" } });
    await waitFor(() => expect(customInput).toHaveFocus());
    fakeEditor.isFocused = false;

    act(() => {
      selectionOffscreen = true;
      window.dispatchEvent(new Event("scroll"));
    });
    expect(screen.queryByPlaceholderText("Tell me how to edit this…")).not.toBeInTheDocument();

    act(() => {
      selectionOffscreen = false;
      window.dispatchEvent(new Event("scroll"));
    });

    const restoredInput = await screen.findByPlaceholderText("Tell me how to edit this…");
    expect(restoredInput).toHaveValue("Keep this direct");
    await waitFor(() => expect(restoredInput).toHaveFocus());
  });
});
