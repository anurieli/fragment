import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShortformView } from "@/components/shortform/shortform-view";
import type { ContentPiece, Idea } from "@/lib/content-engine";
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

vi.mock("@/components/idea/idea-panel", () => ({ IdeaPanelToggle: () => null }));
vi.mock("@/components/shortform/space-toggle", () => ({ SpaceToggle: () => null }));
vi.mock("@/components/shortform/piece-filter-bar", () => ({ PieceFilterBar: () => null }));
vi.mock("@/components/shortform/shortform-empty-state", () => ({ ShortformEmptyState: () => null }));
vi.mock("@/components/shortform/idea-resources", () => ({ IdeaResources: () => null }));
vi.mock("@/components/shortform/shortform-feed", () => ({
  ShortformFeed: ({
    pieces,
    editing,
    onFocusCard,
    onEnterEdit,
  }: {
    pieces: readonly ContentPiece[];
    editing: boolean;
    onFocusCard: (index: number) => void;
    onEnterEdit: () => void;
  }) => (
    <div data-testid="feed" data-editing={editing ? "true" : "false"}>
      {pieces.map((piece, index) => (
        <section key={piece.id} data-piece-page>
          <button
            data-piece-card
            data-piece-id={piece.id}
            onClick={() => onFocusCard(index)}
            onDoubleClick={() => {
              onFocusCard(index);
              onEnterEdit();
            }}
          >
            {piece.id}
          </button>
        </section>
      ))}
    </div>
  ),
}));

const idea: Idea = {
  id: "idea-1",
  title: "Idea",
  parentId: null,
  priority: 0,
  origin: "user",
  createdAt: 1,
  updatedAt: 1,
};

function piece(id: string, createdAt: number): ContentPiece {
  return {
    id,
    ideaId: idea.id,
    format: "other",
    status: "ready",
    origin: "user",
    body: id,
    seen: true,
    priority: 0,
    order: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("ShortformView scroll focus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = vi.fn();
    useAppStore.setState({ focusedPieceId: null, hoveredPieceId: null, revealPieceId: null });
    const newest = piece("newest", 2);
    const older = piece("older", 1);
    useContentStore.setState({
      hydrated: true,
      ideas: { [idea.id]: idea },
      pieces: { [newest.id]: newest, [older.id]: older },
      resources: {},
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps the page reached by manual scroll as the focused piece", () => {
    const view = render(<ShortformView ideaId={idea.id} />);

    const scroller = view.container.querySelector<HTMLElement>(".overflow-y-auto");
    const pages = view.container.querySelectorAll<HTMLElement>("[data-piece-page]");
    expect(scroller).not.toBeNull();
    expect(pages).toHaveLength(2);

    scroller!.getBoundingClientRect = () => ({
      top: 100,
      right: 800,
      bottom: 700,
      left: 0,
      width: 800,
      height: 600,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    pages[0].getBoundingClientRect = () => ({
      top: 100,
      right: 800,
      bottom: 700,
      left: 0,
      width: 800,
      height: 600,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    pages[1].getBoundingClientRect = () => ({
      top: 700,
      right: 800,
      bottom: 1300,
      left: 0,
      width: 800,
      height: 600,
      x: 0,
      y: 700,
      toJSON: () => ({}),
    });
    const newestScroll = vi.fn();
    const olderScroll = vi.fn();
    pages[0].scrollIntoView = newestScroll;
    pages[1].scrollIntoView = olderScroll;

    fireEvent.click(screen.getByRole("button", { name: "older" }));
    expect(useAppStore.getState().focusedPieceId).toBe("older");
    expect(olderScroll).toHaveBeenCalledOnce();
    olderScroll.mockClear();

    act(() => {
      fireEvent.scroll(scroller!);
      const pieces = useContentStore.getState().pieces;
      useContentStore.setState({
        pieces: {
          ...pieces,
          older: { ...pieces.older, body: "updated while scrolling", updatedAt: 3 },
        },
      });
    });

    // A content update used to re-run scrollIntoView for the stale focus before
    // the manual snap could become focus, pulling the deck back to this page.
    expect(olderScroll).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(useAppStore.getState().focusedPieceId).toBe("newest");
    expect(newestScroll).toHaveBeenCalledOnce();
  });

  it("does not let a pending scroll debounce overwrite newer edit focus", () => {
    const view = render(<ShortformView ideaId={idea.id} />);
    const scroller = view.container.querySelector<HTMLElement>(".overflow-y-auto");
    const pages = view.container.querySelectorAll<HTMLElement>("[data-piece-page]");

    scroller!.getBoundingClientRect = () => ({
      top: 100,
      right: 800,
      bottom: 700,
      left: 0,
      width: 800,
      height: 600,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    pages[0].getBoundingClientRect = () => ({
      top: -500,
      right: 800,
      bottom: 100,
      left: 0,
      width: 800,
      height: 600,
      x: 0,
      y: -500,
      toJSON: () => ({}),
    });
    pages[1].getBoundingClientRect = () => ({
      top: 100,
      right: 800,
      bottom: 700,
      left: 0,
      width: 800,
      height: 600,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByRole("button", { name: "newest" }));
    fireEvent.scroll(scroller!);
    fireEvent.doubleClick(screen.getByRole("button", { name: "newest" }));
    expect(screen.getByTestId("feed")).toHaveAttribute("data-editing", "true");

    act(() => {
      vi.advanceTimersByTime(150);
    });

    expect(useAppStore.getState().focusedPieceId).toBe("newest");
    expect(screen.getByTestId("feed")).toHaveAttribute("data-editing", "true");
  });
});
