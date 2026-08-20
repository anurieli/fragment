import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShortformView } from "@/components/shortform/shortform-view";
import { useEmptyCreationCleanup } from "@/hooks/use-empty-creation-cleanup";
import { resetEmptyCreations } from "@/lib/empty-creations";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";

vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>("@/lib/persistence");
  return {
    ...actual,
    saveNote: vi.fn().mockResolvedValue(undefined),
    deleteNoteAndSnippets: vi.fn().mockResolvedValue(undefined),
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
  useDataStore.setState({ notes: {}, snippets: {}, versions: {}, hydrated: true });
  useContentStore.setState({ ideas: {}, pieces: {}, resources: {}, hydrated: true });
  useAppStore.setState({
    activeNoteId: null,
    activeIdeaId: null,
    focusedPieceId: null,
    liveEditorNoteId: null,
    liveEditorContent: null,
  });
}

describe("useEmptyCreationCleanup", () => {
  beforeEach(resetStores);
  afterEach(cleanup);

  it("deletes a newly created blank note when navigation leaves it", async () => {
    render(<CleanupHarness />);

    let id = "";
    act(() => {
      id = useDataStore.getState().createNote();
      useAppStore.getState().setActiveNote(id);
    });
    act(() => useAppStore.getState().setActiveNote(null));

    await waitFor(() => expect(useDataStore.getState().notes[id]).toBeUndefined());
  });

  it("deletes an active blank creation when the page session exits", async () => {
    render(<CleanupHarness />);

    let id = "";
    act(() => {
      id = useDataStore.getState().createNote();
      useAppStore.getState().setActiveNote(id);
    });
    act(() => window.dispatchEvent(new Event("pagehide")));

    await waitFor(() => expect(useDataStore.getState().notes[id]).toBeUndefined());
  });

  it("keeps a newly created note after the user adds content", async () => {
    render(<CleanupHarness />);

    let id = "";
    act(() => {
      id = useDataStore.getState().createNote();
      useDataStore.getState().updateNoteContent(id, "Keep this thought");
      useAppStore.getState().setActiveNote(id);
    });
    act(() => useAppStore.getState().setActiveNote(null));

    await waitFor(() => expect(useDataStore.getState().notes[id]?.content).toBe("Keep this thought"));
  });

  it("keeps a note whose editor has unsaved live content", async () => {
    render(<CleanupHarness />);

    let id = "";
    act(() => {
      id = useDataStore.getState().createNote();
      useAppStore.getState().setActiveNote(id);
      useAppStore.getState().setLiveEditorContent(id, "Typed just before navigation");
    });
    act(() => useAppStore.getState().setActiveNote(null));

    await waitFor(() => expect(useDataStore.getState().notes[id]).toBeDefined());
  });

  it("tombstones a new untitled idea when navigation leaves it", async () => {
    render(<CleanupHarness />);

    let id = "";
    act(() => {
      id = useContentStore.getState().createIdea({ title: "Untitled idea" });
      useAppStore.getState().setActiveIdea(id);
    });
    act(() => useAppStore.getState().setActiveIdea(null));

    await waitFor(() => expect(useContentStore.getState().ideas[id]?.deletedAt).toBeDefined());
  });

  it("tombstones a new blank piece when focus leaves it", async () => {
    render(<CleanupHarness />);

    let id = "";
    act(() => {
      const ideaId = useContentStore.getState().createIdea({ title: "Kept idea" });
      id = useContentStore.getState().createPiece({ ideaId, format: "other", origin: "user", body: "" });
      useAppStore.getState().setFocusedPiece(id);
    });
    act(() => useAppStore.getState().setFocusedPiece(null));

    await waitFor(() => expect(useContentStore.getState().pieces[id]?.deletedAt).toBeDefined());
  });

  it("removes a blank piece before deciding whether its new parent idea is empty", async () => {
    render(<CleanupHarness />);

    let ideaId = "";
    let pieceId = "";
    act(() => {
      ideaId = useContentStore.getState().createIdea({ title: "Untitled idea" });
      pieceId = useContentStore.getState().createPiece({
        ideaId,
        format: "other",
        origin: "user",
        body: "",
      });
      useAppStore.getState().setActiveIdea(ideaId);
      useAppStore.getState().setFocusedPiece(pieceId);
    });
    act(() => {
      useAppStore.getState().setFocusedPiece(null);
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
    const workOnIt = screen.getByRole("button", { name: "Work on it" });
    const pieceId = Object.values(useContentStore.getState().pieces).find(
      (piece) => piece.ideaId === ideaId && piece.deletedAt === undefined,
    )?.id as string;

    fireEvent.blur(textarea, { relatedTarget: workOnIt });
    fireEvent.focus(workOnIt);
    fireEvent.click(workOnIt);

    await waitFor(() => {
      const piece = useContentStore.getState().pieces[pieceId];
      expect(piece.deletedAt).toBeUndefined();
      expect(piece.status).toBe("in-progress");
    });
  });

  it("tombstones a new blank piece when its editor loses focus", async () => {
    const ideaId = useContentStore.getState().createIdea({ title: "Kept idea" });
    render(<ShortformView ideaId={ideaId} />);

    fireEvent.click(screen.getByRole("button", { name: "New piece" }));
    const textarea = await screen.findByPlaceholderText(/^Write/);
    const pieceId = Object.values(useContentStore.getState().pieces).find(
      (piece) => piece.ideaId === ideaId && piece.deletedAt === undefined,
    )?.id;
    expect(pieceId).toBeDefined();

    fireEvent.blur(textarea);

    await waitFor(() => expect(useContentStore.getState().pieces[pieceId as string]?.deletedAt).toBeDefined());
  });
});
