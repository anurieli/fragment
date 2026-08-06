import { describe, it, expect, beforeEach, vi } from "vitest";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";

// Mock the persistence layer — stores call these on every mutation.
// promoteCommentToIdea reaches into content-store's createIdea, which calls
// saveIdea on this same module, so importActual + override (rather than a
// bare replacement object) keeps that path from calling undefined.
vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>(
    "@/lib/persistence",
  );
  return {
    ...actual,
    saveNote: vi.fn().mockResolvedValue(undefined),
    deleteNoteAndSnippets: vi.fn(),
    saveSnippet: vi.fn(),
    deleteSnippet: vi.fn(),
    saveVersion: vi.fn(),
    deleteVersion: vi.fn(),
    saveComment: vi.fn(),
    saveIdea: vi.fn().mockResolvedValue(undefined),
  };
});

function resetStore() {
  useDataStore.setState({
    notes: {},
    snippets: {},
    versions: {},
    comments: {},
    hydrated: true,
  });
  useAppStore.setState({
    activeNoteId: null,
    liveEditorNoteId: null,
    liveEditorContent: null,
    timelinePreviewVersionId: null,
  });
  useContentStore.setState({ ideas: {}, pieces: {}, resources: {}, hydrated: true });
}

describe("data-store — notes", () => {
  beforeEach(resetStore);

  it("createNote adds a note and returns its id", () => {
    const id = useDataStore.getState().createNote();
    const note = useDataStore.getState().notes[id];

    expect(note).toBeDefined();
    expect(note.title).toBe("");
    expect(note.content).toBe("");
    expect(note.goal).toBe("");
    expect(note.id).toBe(id);
  });

  it("updateNoteContent updates content and bumps updatedAt", () => {
    const id = useDataStore.getState().createNote();
    const before = useDataStore.getState().notes[id].updatedAt;

    // Small delay to ensure timestamp changes
    useDataStore.getState().updateNoteContent(id, "hello world");
    const after = useDataStore.getState().notes[id];

    expect(after.content).toBe("hello world");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("updateNoteTitle updates title", () => {
    const id = useDataStore.getState().createNote();
    useDataStore.getState().updateNoteTitle(id, "My Essay");
    expect(useDataStore.getState().notes[id].title).toBe("My Essay");
  });

  it("updateNoteGoal updates goal", () => {
    const id = useDataStore.getState().createNote();
    useDataStore.getState().updateNoteGoal(id, "Convince the reader");
    expect(useDataStore.getState().notes[id].goal).toBe("Convince the reader");
  });

  it("updateNoteContent on non-existent id is a no-op", () => {
    useDataStore.getState().updateNoteContent("fake-id", "x");
    expect(Object.keys(useDataStore.getState().notes)).toHaveLength(0);
  });

  it("deleteNote removes the note and its snippets", () => {
    const id = useDataStore.getState().createNote();
    useDataStore.getState().addSnippet(id, "snippet text");

    useDataStore.getState().deleteNote(id);

    expect(useDataStore.getState().notes[id]).toBeUndefined();
    const remaining = Object.values(useDataStore.getState().snippets).filter(
      (s) => s.noteId === id,
    );
    expect(remaining).toHaveLength(0);
  });

  it("deleteNote returns the next most recent note id", () => {
    const id1 = useDataStore.getState().createNote();
    const id2 = useDataStore.getState().createNote();
    // id2 was created after id1, so it has a higher updatedAt
    const nextId = useDataStore.getState().deleteNote(id2);
    expect(nextId).toBe(id1);
  });

  it("deleteNote returns null when no notes remain", () => {
    const id = useDataStore.getState().createNote();
    const nextId = useDataStore.getState().deleteNote(id);
    expect(nextId).toBeNull();
  });

  it("setNotes hydrates from an array", () => {
    const notes = [
      {
        id: "a",
        title: "A",
        content: "",
        goal: "",
        audience: "",
        tone: "",
        remember: "",
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "b",
        title: "B",
        content: "",
        goal: "",
        audience: "",
        tone: "",
        remember: "",
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    useDataStore.getState().setNotes(notes);
    expect(Object.keys(useDataStore.getState().notes)).toHaveLength(2);
    expect(useDataStore.getState().notes["a"].title).toBe("A");
  });
});

describe("data-store — snippets", () => {
  beforeEach(resetStore);

  it("addSnippet appends to the end by default", () => {
    const noteId = useDataStore.getState().createNote();

    const s1 = useDataStore.getState().addSnippet(noteId, "first");
    const s2 = useDataStore.getState().addSnippet(noteId, "second");

    const snippets = useDataStore.getState().snippets;
    expect(snippets[s1].order).toBe(0);
    expect(snippets[s2].order).toBe(1);
  });

  it("addSnippet at index shifts existing snippets", () => {
    const noteId = useDataStore.getState().createNote();

    const s1 = useDataStore.getState().addSnippet(noteId, "first");
    const s2 = useDataStore.getState().addSnippet(noteId, "second");
    const s3 = useDataStore.getState().addSnippet(noteId, "inserted", 1);

    const snippets = useDataStore.getState().snippets;
    expect(snippets[s1].order).toBe(0);
    expect(snippets[s3].order).toBe(1);
    expect(snippets[s2].order).toBe(2);
  });

  it("addSnippet sets labelStatus to loading", () => {
    const noteId = useDataStore.getState().createNote();
    const id = useDataStore.getState().addSnippet(noteId, "text");
    expect(useDataStore.getState().snippets[id].labelStatus).toBe("loading");
  });

  it("updateSnippetLabel updates label and status", () => {
    const noteId = useDataStore.getState().createNote();
    const id = useDataStore.getState().addSnippet(noteId, "text");

    useDataStore.getState().updateSnippetLabel(id, "Introduction", "done");
    const snippet = useDataStore.getState().snippets[id];
    expect(snippet.label).toBe("Introduction");
    expect(snippet.labelStatus).toBe("done");
  });

  it("updateSnippetLabel on non-existent id is a no-op", () => {
    useDataStore.getState().updateSnippetLabel("fake", "label", "done");
    expect(Object.keys(useDataStore.getState().snippets)).toHaveLength(0);
  });

  it("removeSnippet removes from state", () => {
    const noteId = useDataStore.getState().createNote();
    const id = useDataStore.getState().addSnippet(noteId, "text");

    useDataStore.getState().removeSnippet(id);
    expect(useDataStore.getState().snippets[id]).toBeUndefined();
  });

  it("reorderSnippets updates order values", () => {
    const noteId = useDataStore.getState().createNote();
    const s1 = useDataStore.getState().addSnippet(noteId, "a");
    const s2 = useDataStore.getState().addSnippet(noteId, "b");

    useDataStore.getState().reorderSnippets([
      { id: s1, order: 1 },
      { id: s2, order: 0 },
    ]);

    const snippets = useDataStore.getState().snippets;
    expect(snippets[s1].order).toBe(1);
    expect(snippets[s2].order).toBe(0);
  });

  it("addSnippet files a piece's snip against the idea when there is no note", () => {
    const id = useDataStore.getState().addSnippet(null, "cut from a piece", undefined, "idea-1");

    const snippet = useDataStore.getState().snippets[id];
    expect(snippet).toBeDefined();
    expect(snippet.noteId).toBeNull();
    expect(snippet.ideaId).toBe("idea-1");
  });

  it("addSnippet refuses a snippet with no home rather than losing it", () => {
    expect(useDataStore.getState().addSnippet(null, "homeless")).toBe("");
    expect(Object.keys(useDataStore.getState().snippets)).toHaveLength(0);
  });

  it("addSnippet orders within a home, not across homes", () => {
    const noteId = useDataStore.getState().createNote();

    const n1 = useDataStore.getState().addSnippet(noteId, "note first");
    const i1 = useDataStore.getState().addSnippet(null, "idea first", undefined, "idea-1");
    const n2 = useDataStore.getState().addSnippet(noteId, "note second");
    const i2 = useDataStore.getState().addSnippet(null, "idea second", undefined, "idea-1");

    const snippets = useDataStore.getState().snippets;
    expect([snippets[n1].order, snippets[n2].order]).toEqual([0, 1]);
    expect([snippets[i1].order, snippets[i2].order]).toEqual([0, 1]);
  });

  it("setSnippets hydrates from an array", () => {
    const snippets = [
      { id: "x", noteId: "n1", content: "text", label: null, labelStatus: "idle" as const, createdAt: 1, order: 0 },
    ];
    useDataStore.getState().setSnippets(snippets);
    expect(useDataStore.getState().snippets["x"]).toBeDefined();
    expect(useDataStore.getState().snippets["x"].content).toBe("text");
  });
});

describe("data-store — comments", () => {
  beforeEach(resetStore);

  it("addComment attaches to a note", () => {
    const noteId = useDataStore.getState().createNote();
    const id = useDataStore.getState().addComment(noteId, null, "worth digging into");

    const comment = useDataStore.getState().comments[id];
    expect(comment).toBeDefined();
    expect(comment.noteId).toBe(noteId);
    expect(comment.ideaId).toBeNull();
    expect(comment.promotedIdeaId).toBeNull();
  });

  it("addComment attaches to an idea", () => {
    const id = useDataStore.getState().addComment(null, "idea-1", "a piece thought");
    const comment = useDataStore.getState().comments[id];
    expect(comment.noteId).toBeNull();
    expect(comment.ideaId).toBe("idea-1");
  });

  it("addComment refuses a comment with no home rather than losing it", () => {
    expect(useDataStore.getState().addComment(null, null, "homeless")).toBe("");
    expect(Object.keys(useDataStore.getState().comments)).toHaveLength(0);
  });

  it("promoteCommentToIdea creates an idea seeded from the comment and stamps promotedIdeaId", () => {
    const noteId = useDataStore.getState().createNote();
    const commentId = useDataStore.getState().addComment(noteId, null, "This deserves its own idea");

    const ideaId = useDataStore.getState().promoteCommentToIdea(commentId);

    expect(ideaId).not.toBe("");
    const idea = useContentStore.getState().ideas[ideaId];
    expect(idea).toBeDefined();
    expect(idea.title).toBe("This deserves its own idea");
    expect(idea.summary).toBe("This deserves its own idea");

    const comment = useDataStore.getState().comments[commentId];
    expect(comment.promotedIdeaId).toBe(ideaId);
  });

  it("promoteCommentToIdea is a no-op on an already-promoted comment", () => {
    const noteId = useDataStore.getState().createNote();
    const commentId = useDataStore.getState().addComment(noteId, null, "one idea only");
    const firstIdeaId = useDataStore.getState().promoteCommentToIdea(commentId);

    const secondResult = useDataStore.getState().promoteCommentToIdea(commentId);

    expect(secondResult).toBe("");
    expect(useDataStore.getState().comments[commentId].promotedIdeaId).toBe(firstIdeaId);
    expect(Object.keys(useContentStore.getState().ideas)).toHaveLength(1);
  });

  it("setComments hydrates from an array", () => {
    const comments = [
      { id: "c1", noteId: "n1", ideaId: null, body: "hello", createdAt: 1, updatedAt: 1, promotedIdeaId: null },
    ];
    useDataStore.getState().setComments(comments);
    expect(useDataStore.getState().comments["c1"]).toBeDefined();
    expect(useDataStore.getState().comments["c1"].body).toBe("hello");
  });
});

describe("data-store — versions", () => {
  beforeEach(resetStore);

  it("createVersion uses live editor content when available for the same note", () => {
    const noteId = useDataStore.getState().createNote();
    useDataStore.getState().updateNoteContent(noteId, "saved content");
    useAppStore.getState().setLiveEditorContent(noteId, "saved content\n\n\u00A0\n\nlatest line");

    const versionId = useDataStore.getState().createVersion(noteId, "Quick save", "manual");
    const version = useDataStore.getState().versions[versionId];

    expect(version.content).toBe("saved content\n\n\u00A0\n\nlatest line");
  });

  it("createVersion falls back to note content when live editor content is for another note", () => {
    const noteId = useDataStore.getState().createNote();
    useDataStore.getState().updateNoteContent(noteId, "note content");
    useAppStore.getState().setLiveEditorContent("other-note", "other content");

    const versionId = useDataStore.getState().createVersion(noteId, "Quick save", "manual");
    const version = useDataStore.getState().versions[versionId];

    expect(version.content).toBe("note content");
  });
});
