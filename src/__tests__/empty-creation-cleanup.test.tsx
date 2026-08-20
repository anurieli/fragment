import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShortformView } from "@/components/shortform/shortform-view";
import { useEmptyCreationCleanup } from "@/hooks/use-empty-creation-cleanup";
import { resetEmptyCreations } from "@/lib/empty-creations";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";

vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>("@/lib/persistence");
  return {
    ...actual,
    saveIdea: vi.fn().mockResolvedValue(undefined),
    savePiece: vi.fn().mockResolvedValue(undefined),
  };
});

function CleanupHarness() {
  useEmptyCreationCleanup();
  return null;
}

function resetStores() {
  resetEmptyCreations();
  useContentStore.setState({ ideas: {}, pieces: {}, resources: {}, hydrated: true });
  useAppStore.setState({
    activePieceId: null,
    activeIdeaId: null,
    focusedPieceId: null,
    liveEditorPieceId: null,
    liveEditorContent: null,
  });
}

function createBlankPiece(format: "essay" | "other" = "essay") {
  const ideaId = useContentStore.getState().createIdea({ title: "Kept idea" });
  const pieceId = useContentStore.getState().createPiece({
    ideaId,
    format,
    origin: "user",
    status: "in-progress",
    body: "",
    seen: true,
  });
  return { ideaId, pieceId };
}

describe("useEmptyCreationCleanup", () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it("tombstones a newly created blank draft when navigation leaves it", async () => {
    render(<CleanupHarness />);
    const { pieceId } = createBlankPiece();

    await act(async () => useAppStore.getState().setActivePiece(pieceId));
    await act(async () => useAppStore.getState().setActivePiece(null));

    await waitFor(() => expect(useContentStore.getState().pieces[pieceId]?.deletedAt).toBeDefined());
  });

  it("tombstones an active blank creation when the page session exits", async () => {
    render(<CleanupHarness />);
    const { pieceId } = createBlankPiece();

    await act(async () => useAppStore.getState().setActivePiece(pieceId));
    act(() => window.dispatchEvent(new Event("pagehide")));

    await waitFor(() => expect(useContentStore.getState().pieces[pieceId]?.deletedAt).toBeDefined());
  });

  it("keeps a draft whose editor has unsaved live content", async () => {
    render(<CleanupHarness />);
    const { pieceId } = createBlankPiece();

    await act(async () => {
      useAppStore.getState().setActivePiece(pieceId);
      useAppStore.getState().setLiveEditorContent(pieceId, "Typed just before navigation");
    });
    await act(async () => useAppStore.getState().setActivePiece(null));

    await waitFor(() => {
      const piece = useContentStore.getState().pieces[pieceId];
      expect(piece.deletedAt).toBeUndefined();
      expect(piece.body).toBe("Typed just before navigation");
    });
  });

  it("tombstones a new untitled idea when navigation leaves it", async () => {
    render(<CleanupHarness />);
    let ideaId = "";

    await act(async () => {
      ideaId = useContentStore.getState().createIdea({ title: "Untitled idea" });
      useAppStore.getState().setActiveIdea(ideaId);
    });
    await act(async () => useAppStore.getState().setActiveIdea(null));

    await waitFor(() => expect(useContentStore.getState().ideas[ideaId]?.deletedAt).toBeDefined());
  });

  it("removes a blank piece before deciding whether its new parent idea is empty", async () => {
    render(<CleanupHarness />);
    let ideaId = "";
    let pieceId = "";

    await act(async () => {
      ideaId = useContentStore.getState().createIdea({ title: "Untitled idea" });
      pieceId = useContentStore.getState().createPiece({
        ideaId,
        format: "essay",
        origin: "user",
        status: "in-progress",
        body: "",
        seen: true,
      });
      useAppStore.getState().setActiveIdea(ideaId);
      useAppStore.getState().setActivePiece(pieceId);
    });
    await act(async () => {
      useAppStore.getState().setActivePiece(null);
      useAppStore.getState().setActiveIdea(null);
    });

    await waitFor(() => {
      expect(useContentStore.getState().pieces[pieceId]?.deletedAt).toBeDefined();
      expect(useContentStore.getState().ideas[ideaId]?.deletedAt).toBeDefined();
    });
  });

  it("does not discard a blank piece while focus moves to controls inside its card", async () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Kept idea" });
    render(<ShortformView ideaId={ideaId} />);

    fireEvent.click(screen.getByRole("button", { name: "New piece" }));
    const textarea = await screen.findByPlaceholderText(/^Write/);
    const card = textarea.closest("[data-piece-card]") as HTMLElement;
    const internalButton = card.querySelector("button") as HTMLButtonElement;
    const pieceId = card.dataset.pieceId as string;

    fireEvent.blur(textarea, { relatedTarget: internalButton });
    fireEvent.focus(internalButton);

    await waitFor(() => expect(useContentStore.getState().pieces[pieceId]?.deletedAt).toBeUndefined());
  });

  it("tombstones a new blank piece when its editor loses focus", async () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Kept idea" });
    render(<ShortformView ideaId={ideaId} />);

    fireEvent.click(screen.getByRole("button", { name: "New piece" }));
    const textarea = await screen.findByPlaceholderText(/^Write/);
    const card = textarea.closest("[data-piece-card]") as HTMLElement;
    const pieceId = card.dataset.pieceId as string;

    fireEvent.blur(textarea);

    await waitFor(() => expect(useContentStore.getState().pieces[pieceId]?.deletedAt).toBeDefined());
  });
});
