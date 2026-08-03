import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@/components/editor/editor";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";

vi.mock("@/lib/persistence", () => ({
  saveNote: vi.fn().mockResolvedValue(true),
  deleteNoteAndSnippets: vi.fn().mockResolvedValue(undefined),
  saveSnippet: vi.fn().mockResolvedValue(true),
  deleteSnippet: vi.fn().mockResolvedValue(undefined),
  saveVersion: vi.fn().mockResolvedValue(true),
  deleteVersion: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/components/editor/note-creation-flow", () => ({
  NoteCreationFlow: () => null,
  EmptyNoteActions: () => null,
  ContextFieldsTooltip: () => null,
}));
vi.mock("@/components/editor/note-header", () => ({ NoteHeader: () => null }));
vi.mock("@/components/editor/export-menu", () => ({ ExportMenu: () => null }));
vi.mock("@/components/review/comments-affordance", () => ({ CommentsAffordance: () => null }));
vi.mock("@/components/editor/inline-edit-menu", () => ({ InlineEditMenu: () => null }));
vi.mock("@/components/timeline/version-preview-banner", () => ({ VersionPreviewBanner: () => null }));
vi.mock("@/components/editor/note-usage-footer", () => ({ NoteUsageFooter: () => null }));
vi.mock("@/hooks/use-label-snippet", () => ({ useLabelSnippet: () => ({ labelSnippet: vi.fn() }) }));
vi.mock("@/hooks/use-slash-command", () => ({ useSlashCommand: () => ({ enabled: false }) }));
vi.mock("@/hooks/use-inline-edit", () => ({ useInlineEdit: () => ({ edit: vi.fn(), enabled: false }) }));
vi.mock("@/hooks/use-save-status", () => ({ useSaveStatus: () => "saved" }));
vi.mock("@/hooks/use-stream-generation", () => ({
  useStreamGeneration: () => ({ startGeneration: vi.fn(), abort: vi.fn() }),
}));
vi.mock("@/hooks/use-generate-title", () => ({
  useGenerateTitle: () => ({ generateTitle: vi.fn(), isGenerating: false }),
}));

function resetStores() {
  localStorage.clear();
  useDataStore.setState({ notes: {}, snippets: {}, versions: {}, hydrated: true });
  useAppStore.setState({
    activeNoteId: null,
    liveEditorNoteId: null,
    liveEditorContent: null,
    pendingSnippetDrop: null,
    pendingEditorDeletion: null,
    pendingSnippetInsert: null,
    timelinePreviewVersionId: null,
    showCreationFlow: false,
    generatingNoteId: null,
    streamingContent: null,
  });
}

async function renderNote(content: string) {
  const noteId = useDataStore.getState().createNote({ content });
  useAppStore.getState().setActiveNote(noteId);
  const view = render(<Editor />);
  const editor = await waitFor(() => {
    const element = view.container.querySelector(".tiptap");
    expect(element).toHaveTextContent(content);
    return element as HTMLElement;
  });
  return { ...view, editor, noteId };
}

describe("editor snippet movement history", () => {
  beforeEach(resetStores);

  it("undoes both halves of an editor-to-Snip-Bar move", async () => {
    const { editor, noteId, getByTitle } = await renderNote("One two three");
    let snippetId = "";

    act(() => {
      snippetId = useDataStore.getState().addSnippet(noteId, "two ");
      useAppStore.getState().setPendingEditorDeletion({ from: 5, to: 9, snippetId });
    });

    await waitFor(() => expect(editor).toHaveTextContent("One three"));
    expect(useDataStore.getState().snippets[snippetId]).toBeDefined();

    fireEvent.click(getByTitle("Undo (⌘Z)"));

    await waitFor(() => expect(editor).toHaveTextContent("One two three"));
    expect(useDataStore.getState().snippets[snippetId]).toBeUndefined();

    fireEvent.click(getByTitle("Redo (⌘⇧Z)"));

    await waitFor(() => expect(editor).toHaveTextContent("One three"));
    expect(useDataStore.getState().snippets[snippetId]).toBeDefined();
  });

  it("does not consume a snippet insertion when no note is open", async () => {
    const snippetId = "idea-snippet";
    useDataStore.setState({
      snippets: {
        [snippetId]: {
          id: snippetId,
          noteId: null,
          ideaId: "idea-1",
          content: "Keep this text",
          label: null,
          labelStatus: "done",
          createdAt: 1,
          order: 0,
        },
      },
    });
    render(<Editor />);

    act(() => {
      useAppStore.getState().setPendingSnippetInsert({
        snippetId,
        content: "Keep this text",
      });
    });

    await waitFor(() => {
      expect(useAppStore.getState().pendingSnippetInsert).toBeNull();
    });
    expect(useDataStore.getState().snippets[snippetId]).toBeDefined();
  });
});
