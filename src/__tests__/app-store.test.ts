import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/stores/app-store";

function resetStore() {
  useAppStore.setState({
    sidebarOpen: true,
    sidebarPinned: true,
    helperBarOpen: true,
    timelineOpen: false,
    timelinePreviewVersionId: null,
    activePieceId: null,
    isDraggingToHelper: false,
    isDraggingToEditor: false,
  });
}

describe("app-store", () => {
  beforeEach(resetStore);

  it("toggleSidebar flips the boolean, and pins together with it", () => {
    expect(useAppStore.getState().sidebarOpen).toBe(true);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(false);
    expect(useAppStore.getState().sidebarPinned).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(true);
    expect(useAppStore.getState().sidebarPinned).toBe(true);
  });

  /**
   * Peeking is what hovering the rail does. It must never touch the pinned
   * flag, or a hover would be remembered as a preference; and it must do
   * nothing at all while pinned, or leaving the sidebar would close a sidebar
   * the user deliberately opened.
   */
  it("peekSidebar opens without pinning, and is inert while pinned", () => {
    useAppStore.setState({ sidebarOpen: false, sidebarPinned: false });

    useAppStore.getState().peekSidebar(true);
    expect(useAppStore.getState().sidebarOpen).toBe(true);
    expect(useAppStore.getState().sidebarPinned).toBe(false);

    useAppStore.getState().peekSidebar(false);
    expect(useAppStore.getState().sidebarOpen).toBe(false);

    useAppStore.setState({ sidebarOpen: true, sidebarPinned: true });
    useAppStore.getState().peekSidebar(false);
    expect(useAppStore.getState().sidebarOpen).toBe(true);
  });

  it("setSidebarOpen(false) hands the column back to hover-peek", () => {
    useAppStore.setState({ sidebarOpen: true, sidebarPinned: true });
    useAppStore.getState().setSidebarOpen(false);
    expect(useAppStore.getState().sidebarPinned).toBe(false);
  });

  it("toggleIdeaPanel flips the idea workspace column, setIdeaPanelOpen sets it", () => {
    useAppStore.setState({ ideaPanelOpen: true });
    useAppStore.getState().toggleIdeaPanel();
    expect(useAppStore.getState().ideaPanelOpen).toBe(false);
    useAppStore.getState().setIdeaPanelOpen(true);
    expect(useAppStore.getState().ideaPanelOpen).toBe(true);
  });

  it("toggleHelperBar flips the boolean", () => {
    expect(useAppStore.getState().helperBarOpen).toBe(true);
    useAppStore.getState().toggleHelperBar();
    expect(useAppStore.getState().helperBarOpen).toBe(false);
  });

  it("setActivePiece sets and clears", () => {
    useAppStore.getState().setActivePiece("piece-123");
    expect(useAppStore.getState().activePieceId).toBe("piece-123");

    useAppStore.getState().setActivePiece(null);
    expect(useAppStore.getState().activePieceId).toBeNull();
  });

  it("setDraggingToHelper sets flag", () => {
    useAppStore.getState().setDraggingToHelper(true);
    expect(useAppStore.getState().isDraggingToHelper).toBe(true);

    useAppStore.getState().setDraggingToHelper(false);
    expect(useAppStore.getState().isDraggingToHelper).toBe(false);
  });

  it("setDraggingToEditor sets flag", () => {
    useAppStore.getState().setDraggingToEditor(true);
    expect(useAppStore.getState().isDraggingToEditor).toBe(true);
  });
});
