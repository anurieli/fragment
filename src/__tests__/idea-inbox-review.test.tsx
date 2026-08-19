import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>("@/lib/persistence");
  return {
    ...actual,
    findOriginComment: vi.fn().mockResolvedValue(null),
    savePiece: vi.fn(),
  };
});

import { IdeaPanel } from "@/components/idea/idea-panel";
import { Sidebar } from "@/components/sidebar/sidebar";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import type { ContentPiece, Idea } from "@/lib/content-engine";

const NOW = 1_760_000_000_000;

function idea(id: string): Idea {
  return {
    id,
    title: `Idea ${id}`,
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function inboxPiece(id: string, ideaId: string, createdAt: number): ContentPiece {
  return {
    id,
    ideaId,
    title: `Arrival ${id}`,
    body: "External material",
    format: "linkedin",
    status: "inbox",
    priority: 0,
    order: 0,
    origin: "agent",
    seen: false,
    createdAt,
    updatedAt: createdAt,
  };
}

function resetStores() {
  const first = { ...inboxPiece("p1", "i1", NOW), format: "essay" as const };
  const second = inboxPiece("p2", "i2", NOW + 1);
  useContentStore.setState({
    hydrated: true,
    loadFailed: false,
    ideas: { i1: idea("i1"), i2: idea("i2") },
    pieces: { p1: first, p2: second },
    resources: {},
  });
  useAppStore.setState({
    activeIdeaId: "i1",
    activePieceId: null,
    ideaSpaces: { i1: "pieces" },
    ideaPanelOpen: true,
    inboxReviewRequest: null,
  });
}

describe("idea Inbox review", () => {
  beforeEach(resetStores);

  it("stays collapsed per idea until asked, then approve turns the arrival into a piece", async () => {
    render(<IdeaPanel ideaId="i1" />);

    const inbox = screen.getByRole("button", { name: /Inbox 1 external/i });
    expect(inbox).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();

    fireEvent.click(inbox);
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(useContentStore.getState().pieces.p1).toMatchObject({
        status: "in-progress",
        seen: true,
      });
    });
    expect(useAppStore.getState().inboxReviewRequest).toBeNull();
    expect(screen.queryByRole("button", { name: /Inbox 1 external/i })).not.toBeInTheDocument();
  });

  it("tosses a per-idea Inbox arrival and closes the empty queue", async () => {
    render(<IdeaPanel ideaId="i1" />);

    fireEvent.click(screen.getByRole("button", { name: /Inbox 1 external/i }));
    fireEvent.click(screen.getByRole("button", { name: "Toss this arrival" }));

    await waitFor(() => expect(useContentStore.getState().pieces.p1.deletedAt).toBeDefined());
    expect(useAppStore.getState().inboxReviewRequest).toBeNull();
  });

  it("opens from the global Inbox and advances to the next idea after approval", async () => {
    const noop = vi.fn();
    const sidebar = render(
      <Sidebar
        onOpenSettings={noop}
        onOpenAccount={noop}
        onOpenAI={noop}
        onOpenHelp={noop}
        onOpenCalendar={noop}
        onOpenLogs={noop}
      />,
    );
    expect(screen.getAllByTitle(/0 pieces · 1 in inbox/)).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Inbox 2/i }));
    expect(useAppStore.getState()).toMatchObject({
      activeIdeaId: "i1",
      inboxReviewRequest: { ideaId: "i1", global: true },
    });
    sidebar.unmount();

    render(<IdeaPanel ideaId="i1" />);

    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(useAppStore.getState()).toMatchObject({
      activeIdeaId: "i2",
      inboxReviewRequest: { ideaId: "i2", global: true },
    });
  });
});
