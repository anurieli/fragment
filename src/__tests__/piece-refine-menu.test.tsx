import { useRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isPieceRefineMenuTarget,
  PieceRefineMenu,
} from "@/components/shortform/piece-refine-menu";

function RefineHarness() {
  const [editing, setEditing] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (!editing) return <div>Reading mode</div>;

  return (
    <div ref={containerRef}>
      <textarea
        ref={textareaRef}
        defaultValue="Make this sentence stronger."
        onBlur={(event) => {
          if (!isPieceRefineMenuTarget(event.relatedTarget)) setEditing(false);
        }}
      />
      <PieceRefineMenu
        textareaRef={textareaRef}
        containerRef={containerRef}
        onEdit={vi.fn().mockResolvedValue(null)}
        onSnip={vi.fn()}
        onExitEdit={() => setEditing(false)}
      />
      <button type="button">Outside control</button>
    </div>
  );
}

describe("PieceRefineMenu", () => {
  afterEach(cleanup);

  it("identifies focus moving into its custom instruction UI", () => {
    const menu = document.createElement("div");
    menu.dataset.pieceRefineMenu = "";
    const input = document.createElement("input");
    menu.appendChild(input);

    expect(isPieceRefineMenuTarget(input)).toBe(true);
    expect(isPieceRefineMenuTarget(document.body)).toBe(false);
  });

  it("keeps the piece editing while a custom edit instruction receives focus", async () => {
    render(<RefineHarness />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
      textarea.setSelectionRange(0, 4);
    });
    fireEvent.select(textarea);

    fireEvent.mouseDown(screen.getByTitle("Custom edit"));
    fireEvent.click(screen.getByTitle("Custom edit"));

    const instruction = await screen.findByPlaceholderText("Tell me how to edit this…");
    await waitFor(() => expect(instruction).toHaveFocus());
    expect(screen.queryByText("Reading mode")).not.toBeInTheDocument();
  });

  it("returns the piece to reading mode when focus leaves the custom edit UI", async () => {
    render(<RefineHarness />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
      textarea.setSelectionRange(0, 4);
    });
    fireEvent.select(textarea);
    fireEvent.click(screen.getByTitle("Custom edit"));

    const instruction = await screen.findByPlaceholderText("Tell me how to edit this…");
    act(() => screen.getByRole("button", { name: "Outside control" }).focus());

    await waitFor(() => expect(screen.getByText("Reading mode")).toBeInTheDocument());
    expect(instruction).not.toBeInTheDocument();
  });

  it("returns focus to the piece when the custom edit is cancelled", async () => {
    render(<RefineHarness />);

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    act(() => {
      textarea.focus();
      textarea.setSelectionRange(0, 4);
    });
    fireEvent.select(textarea);
    fireEvent.click(screen.getByTitle("Custom edit"));

    const instruction = await screen.findByPlaceholderText("Tell me how to edit this…");
    fireEvent.keyDown(instruction, { key: "Escape" });

    await waitFor(() => expect(textarea).toHaveFocus());
    expect(screen.queryByText("Reading mode")).not.toBeInTheDocument();
  });
});
