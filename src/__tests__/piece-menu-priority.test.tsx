import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentPiece } from "@/lib/content-engine";

const mocks = vi.hoisted(() => ({
  setPiecePriority: vi.fn(),
  onClose: vi.fn(),
  onDelete: vi.fn(),
}));

vi.mock("@/stores/content-store", () => {
  const state = {
    setPendingFocus: vi.fn(),
    setFilter: vi.fn(),
    createIdea: vi.fn(),
    movePiece: vi.fn(),
    splitIdeaFromPiece: vi.fn(),
    setPieceStatus: vi.fn(),
    setPiecePriority: mocks.setPiecePriority,
    pinPiece: vi.fn(),
    unpinPiece: vi.fn(),
    archivePiece: vi.fn(),
    unarchivePiece: vi.fn(),
  };

  return {
    useContentStore: <T,>(selector: (value: typeof state) => T): T => selector(state),
  };
});

vi.mock("@/stores/app-store", () => {
  const state = {
    setViewMode: vi.fn(),
    setActiveIdea: vi.fn(),
  };

  return {
    useAppStore: <T,>(selector: (value: typeof state) => T): T => selector(state),
  };
});

vi.mock("@/hooks/use-toast", () => {
  const state = { showToast: vi.fn() };
  return {
    useToastStore: <T,>(selector: (value: typeof state) => T): T => selector(state),
  };
});

import { PieceMenuItems } from "@/components/shortform/piece-menu-items";

const piece: ContentPiece = {
  id: "piece-1",
  ideaId: "idea-1",
  title: "One-click priorities",
  body: "Draft body",
  format: "linkedin",
  status: "inbox",
  priority: 3,
  seen: false,
  order: 0,
  origin: "user",
  createdAt: 1,
  updatedAt: 1,
};

describe("PieceMenuItems priority control", () => {
  beforeEach(() => {
    mocks.setPiecePriority.mockReset();
    mocks.onClose.mockReset();
    mocks.onDelete.mockReset();
  });

  afterEach(cleanup);

  it("renders all priority flags directly in the menu and applies one click", () => {
    render(
      <div role="menu">
        <PieceMenuItems piece={piece} onClose={mocks.onClose} onDelete={mocks.onDelete} />
      </div>,
    );

    expect(screen.queryByRole("menuitem", { name: "Set priority" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Priority" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: "High" }));

    expect(mocks.setPiecePriority).toHaveBeenCalledWith("piece-1", 2);
    expect(mocks.onClose).toHaveBeenCalledOnce();
  });
});
