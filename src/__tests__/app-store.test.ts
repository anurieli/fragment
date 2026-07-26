import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/stores/app-store";

function resetStore() {
  useAppStore.setState({
    sidebarOpen: true,
    helperBarOpen: true,
    timelineOpen: false,
    timelinePreviewVersionId: null,
    activeNoteId: null,
    isDraggingToHelper: false,
    isDraggingToEditor: false,
  });
}

describe("app-store", () => {
  beforeEach(resetStore);

  it("toggleSidebar flips the boolean", () => {
    expect(useAppStore.getState().sidebarOpen).toBe(true);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(false);
    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(true);
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

  it("setActiveNote sets and clears", () => {
    useAppStore.getState().setActiveNote("note-123");
    expect(useAppStore.getState().activeNoteId).toBe("note-123");

    useAppStore.getState().setActiveNote(null);
    expect(useAppStore.getState().activeNoteId).toBeNull();
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
