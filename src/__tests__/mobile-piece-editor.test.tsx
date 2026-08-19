import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobilePieceEditor } from "@/components/mobile/mobile-piece-editor";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";

vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>(
    "@/lib/persistence",
  );
  return {
    ...actual,
    saveIdea: vi.fn().mockResolvedValue(undefined),
    savePiece: vi.fn().mockResolvedValue(undefined),
  };
});

function seedIdea() {
  const store = useContentStore.getState();
  const ideaId = store.createIdea({ title: "Mobile notes" });
  const firstId = store.createPiece({
    ideaId,
    format: "other",
    origin: "user",
    status: "in-progress",
    body: "First thought",
  });
  const secondId = store.createPiece({
    ideaId,
    format: "other",
    origin: "user",
    status: "in-progress",
    body: "Second thought",
  });
  return { ideaId, firstId, secondId };
}

describe("MobilePieceEditor", () => {
  beforeEach(() => {
    useContentStore.setState({
      ideas: {},
      pieces: {},
      resources: {},
      hydrated: true,
      loadFailed: false,
    });
    useAppStore.setState({ activeIdeaId: null });
  });

  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
  });

  it("opens an idea as a bare scrollable list of directly editable pieces", () => {
    const { firstId, secondId } = seedIdea();

    render(<MobilePieceEditor />);
    fireEvent.click(screen.getByRole("button", { name: /Mobile notes/ }));

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByText("Piece 1 of 2")).toBeInTheDocument();
    expect(screen.queryByText(/Flow|Refine|AI/i)).not.toBeInTheDocument();

    const editors = screen.getAllByRole("textbox", { name: /Piece \d of 2/ });
    expect(editors).toHaveLength(2);
    expect(editors.map((editor) => (editor as HTMLTextAreaElement).value)).toEqual(
      expect.arrayContaining(["First thought", "Second thought"]),
    );

    const firstEditor = editors.find(
      (editor) => (editor as HTMLTextAreaElement).value === "First thought",
    );
    expect(firstEditor).toBeDefined();
    fireEvent.change(firstEditor as HTMLElement, {
      target: { value: "First thought, extended" },
    });
    expect(useContentStore.getState().pieces[firstId].body).toBe("First thought, extended");
    expect(useContentStore.getState().pieces[secondId].body).toBe("Second thought");
  });

  it("updates the top position bar as the user scrolls between pieces", () => {
    seedIdea();
    render(<MobilePieceEditor />);
    fireEvent.click(screen.getByRole("button", { name: /Mobile notes/ }));

    const scroller = screen.getByTestId("mobile-piece-scroll");
    const pages = Array.from(scroller.querySelectorAll<HTMLElement>("[data-mobile-piece]"));
    pages[0].getBoundingClientRect = () => ({
      top: -500,
      bottom: -100,
      left: 0,
      right: 390,
      width: 390,
      height: 400,
      x: 0,
      y: -500,
      toJSON: () => ({}),
    });
    pages[1].getBoundingClientRect = () => ({
      top: 120,
      bottom: 520,
      left: 0,
      right: 390,
      width: 390,
      height: 400,
      x: 0,
      y: 120,
      toJSON: () => ({}),
    });

    act(() => fireEvent.scroll(scroller));

    expect(screen.getByText("Piece 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  });
});
