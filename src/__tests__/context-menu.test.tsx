import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ContextMenu,
  ContextMenuItem,
  clampContextMenuPosition,
} from "@/components/ui/context-menu";

describe("clampContextMenuPosition", () => {
  it("keeps a menu inside the viewport at the lower-right edge", () => {
    expect(
      clampContextMenuPosition(
        { x: 790, y: 590 },
        { width: 220, height: 180 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 572, top: 412 });
  });

  it("keeps a menu inside the viewport at the upper-left edge", () => {
    expect(
      clampContextMenuPosition(
        { x: -20, y: -10 },
        { width: 220, height: 180 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ left: 8, top: 8 });
  });
});

describe("ContextMenu", () => {
  it("dismisses on Escape and outside pointer down", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ContextMenu position={{ x: 20, y: 30 }} onClose={onClose} ariaLabel="Editor actions">
        <ContextMenuItem label="Copy" onSelect={() => {}} />
      </ContextMenu>,
    );

    expect(screen.getByRole("menu", { name: "Editor actions" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(
      <ContextMenu position={{ x: 20, y: 30 }} onClose={onClose} ariaLabel="Editor actions">
        <ContextMenuItem label="Copy" onSelect={() => {}} />
      </ContextMenu>,
    );
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders shortcuts and badges and runs enabled items", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu position={{ x: 20, y: 30 }} onClose={onClose} ariaLabel="Editor actions">
        <ContextMenuItem label="Settings..." shortcut="⌘," onSelect={onSelect} />
        <ContextMenuItem label="Image Generation" badge="Coming Soon" disabled onSelect={() => {}} />
      </ContextMenu>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: /Settings/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByText("⌘,")).toBeInTheDocument();
    expect(screen.getByText("Coming Soon")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Image Generation/ })).toBeDisabled();
  });
});
