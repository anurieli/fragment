"use client";

import { create } from "zustand";
import type { Note, Snippet, NoteVersion, VersionTrigger, Comment } from "@/lib/types";
import { generateId, wordCount } from "@/lib/utils";
import { snipHomeKey, snippetHome } from "@/lib/snip-scope";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import {
  saveNote,
  deleteNoteAndSnippets,
  saveSnippet,
  deleteSnippet as deleteSnippetFromDB,
  saveVersion,
  deleteVersion as deleteVersionFromDB,
  saveComment,
} from "@/lib/persistence";
import { useToastStore } from "@/hooks/use-toast";
import { captureEvent } from "@/lib/posthog";

/** Fire-and-forget save with user-visible error on IndexedDB failure. */
function persistNote(note: Note): void {
  saveNote(note).catch(() => {
    useToastStore.getState().showToast("Failed to save — your work is backed up locally");
  });
}

interface DataState {
  notes: Record<string, Note>;
  snippets: Record<string, Snippet>;
  versions: Record<string, NoteVersion>;
  comments: Record<string, Comment>;
  hydrated: boolean;

  // Long-form "awaiting confirmation" state for the Substack verified-publish
  // loop: noteId -> the epoch ms a "Publish to Substack" attempt fired.
  // Deliberately NOT persisted to Dexie (or anywhere else) — long-form notes
  // have no dedicated publish-state field, and this is a transient UI signal
  // that a fresh 3-min poll (use-publish-verification.ts) or the user's next
  // explicit action naturally resolves; losing it on reload just means the
  // badge disappears; a genuinely stuck attempt is still visible via
  // Substack itself. See ContentPiece.publishAttemptedAt (content-engine
  // contract) for the equivalent, persisted, short-form piece field.
  pendingSubstackPublish: Record<string, number>;

  setHydrated: (v: boolean) => void;
  setNotes: (notes: Note[]) => void;
  setSnippets: (snippets: Snippet[]) => void;
  setVersions: (versions: NoteVersion[]) => void;
  setComments: (comments: Comment[]) => void;
  markNotePublishPending: (noteId: string) => void;
  clearNotePublishPending: (noteId: string) => void;

  createNote: (opts?: { title?: string; content?: string }) => string;
  updateNoteContent: (id: string, content: string) => void;
  updateNoteTitle: (id: string, title: string) => void;
  updateNoteSubtitle: (id: string, subtitle: string) => void;
  updateNoteGoal: (id: string, goal: string) => void;
  updateNoteAudience: (id: string, audience: string) => void;
  updateNoteTone: (id: string, tone: string) => void;
  updateNoteRemember: (id: string, remember: string) => void;
  updateNoteVoice: (id: string, voiceId: string | null | undefined) => void;
  deleteNote: (id: string) => string | null;

  /** noteId null files the snippet against the idea instead (a snip off a piece). */
  addSnippet: (noteId: string | null, content: string, atIndex?: number, ideaId?: string) => string;
  updateSnippetLabel: (
    id: string,
    label: string | null,
    status: Snippet["labelStatus"],
  ) => void;
  removeSnippet: (id: string) => void;
  restoreSnippet: (snippet: Snippet) => void;
  reorderSnippets: (updates: { id: string; order: number }[]) => void;

  /** Adds a comment against whichever home is passed (exactly one of noteId
   * / ideaId — see commentHome in comment-scope.ts). Empty when neither is
   * set, mirroring addSnippet's homeless refusal. */
  addComment: (noteId: string | null, ideaId: string | null, body: string) => string;
  /** Creates an Idea seeded from the comment's body (via content-store's
   * createIdea) and stamps the comment's promotedIdeaId with it. The comment
   * stays put — this is a forward pointer, not a move. Returns the new
   * idea's id, or "" if the comment is missing or already promoted. */
  promoteCommentToIdea: (id: string) => string;

  createVersion: (noteId: string, name: string, trigger: VersionTrigger) => string;
  removeVersion: (id: string) => void;
  restoreVersion: (versionId: string) => void;
  duplicateFromVersion: (versionId: string) => string;
}

export const useDataStore = create<DataState>((set, get) => ({
  notes: {},
  snippets: {},
  versions: {},
  comments: {},
  hydrated: false,
  pendingSubstackPublish: {},

  setHydrated: (v) => set({ hydrated: v }),

  markNotePublishPending: (noteId) => {
    set((s) => ({ pendingSubstackPublish: { ...s.pendingSubstackPublish, [noteId]: Date.now() } }));
  },

  clearNotePublishPending: (noteId) => {
    set((s) => {
      if (!(noteId in s.pendingSubstackPublish)) return s;
      const next = { ...s.pendingSubstackPublish };
      delete next[noteId];
      return { pendingSubstackPublish: next };
    });
  },

  setNotes: (notes) => {
    const map: Record<string, Note> = {};
    for (const n of notes) map[n.id] = n;
    set({ notes: map });
  },

  setSnippets: (snippets) => {
    const map: Record<string, Snippet> = {};
    for (const s of snippets) map[s.id] = s;
    set({ snippets: map });
  },

  setVersions: (versions) => {
    const map: Record<string, NoteVersion> = {};
    for (const v of versions) map[v.id] = v;
    set({ versions: map });
  },

  setComments: (comments) => {
    const map: Record<string, Comment> = {};
    for (const c of comments) map[c.id] = c;
    set({ comments: map });
  },

  createNote: (opts) => {
    if (!get().hydrated) return "";
    const id = generateId();
    const now = Date.now();
    const note: Note = {
      id,
      title: opts?.title ?? "",
      subtitle: "",
      content: opts?.content ?? "",
      goal: "",
      audience: "",
      tone: "",
      remember: "",
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ notes: { ...s.notes, [id]: note } }));
    persistNote(note);
    captureEvent("note_created");
    return id;
  },

  updateNoteContent: (id, content) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, content, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  updateNoteTitle: (id, title) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, title, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  updateNoteSubtitle: (id, subtitle) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, subtitle, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  updateNoteGoal: (id, goal) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, goal, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  updateNoteAudience: (id, audience) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, audience, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  updateNoteTone: (id, tone) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, tone, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  updateNoteRemember: (id, remember) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, remember, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  updateNoteVoice: (id, voiceId) => {
    if (!get().hydrated) return;
    const note = get().notes[id];
    if (!note) return;
    const updated = { ...note, voiceId, updatedAt: Date.now() };
    set((s) => ({ notes: { ...s.notes, [id]: updated } }));
    persistNote(updated);
  },

  deleteNote: (id) => {
    if (!get().hydrated) return null;
    const state = get();
    const newNotes = { ...state.notes };
    delete newNotes[id];

    const newSnippets = { ...state.snippets };
    for (const [sid, s] of Object.entries(newSnippets)) {
      if (s.noteId === id) delete newSnippets[sid];
    }

    set({ notes: newNotes, snippets: newSnippets });
    // deleteNoteAndSnippets tombstones (deletedAt) any content piece whose
    // content home is this note as part of the same IndexedDB transaction;
    // mirror that in the content-store's in-memory state so the UI reflects
    // it immediately, without waiting on a re-hydration.
    deleteNoteAndSnippets(id);
    useContentStore.getState().detachPieceNote(id);

    const remaining = Object.values(newNotes).sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
    return remaining.length > 0 ? remaining[0].id : null;
  },

  addSnippet: (noteId, content, atIndex?, ideaId?) => {
    if (!get().hydrated) return "";
    // A snippet with neither home would be written to disk and never loaded
    // back (the store holds a window keyed on note and idea), so refuse it
    // here rather than lose it later.
    const home = snipHomeKey(noteId, ideaId);
    if (!home) return "";
    const id = generateId();
    // `order` runs within a home, not across the whole table — see
    // snip-scope.ts. Two homes can be on screen together; their orders
    // interleave in the bar and createdAt breaks the ties.
    const existingSnippets = Object.values(get().snippets)
      .filter((s) => snippetHome(s) === home)
      .sort((a, b) => a.order - b.order);

    let order: number;
    if (atIndex !== undefined && atIndex < existingSnippets.length) {
      // Insert at specific position — shift all snippets at or after this index
      const newSnippets = { ...get().snippets };
      for (const s of existingSnippets) {
        if (s.order >= atIndex) {
          const shifted = { ...s, order: s.order + 1 };
          newSnippets[s.id] = shifted;
          saveSnippet(shifted);
        }
      }
      order = atIndex;

      const snippet: Snippet = {
        id,
        noteId,
        content,
        label: null,
        labelStatus: "loading",
        createdAt: Date.now(),
        order,
        ideaId,
      };
      newSnippets[id] = snippet;
      set({ snippets: newSnippets });
      saveSnippet(snippet);
    } else {
      // Append to end
      const maxOrder = existingSnippets.reduce(
        (max, s) => Math.max(max, s.order),
        -1,
      );
      order = maxOrder + 1;

      const snippet: Snippet = {
        id,
        noteId,
        content,
        label: null,
        labelStatus: "loading",
        createdAt: Date.now(),
        order,
        ideaId,
      };
      set((s) => ({ snippets: { ...s.snippets, [id]: snippet } }));
      saveSnippet(snippet);
    }

    captureEvent("snippet_created");
    return id;
  },

  updateSnippetLabel: (id, label, status) => {
    if (!get().hydrated) return;
    const snippet = get().snippets[id];
    if (!snippet) return;
    const updated = { ...snippet, label, labelStatus: status };
    set((s) => ({ snippets: { ...s.snippets, [id]: updated } }));
    saveSnippet(updated);
  },

  removeSnippet: (id) => {
    if (!get().hydrated) return;
    const newSnippets = { ...get().snippets };
    delete newSnippets[id];
    set({ snippets: newSnippets });
    deleteSnippetFromDB(id);
  },

  restoreSnippet: (snippet) => {
    if (!get().hydrated) return;
    set((s) => ({ snippets: { ...s.snippets, [snippet.id]: snippet } }));
    saveSnippet(snippet);
  },

  reorderSnippets: (updates) => {
    if (!get().hydrated) return;
    const newSnippets = { ...get().snippets };
    for (const { id, order } of updates) {
      if (newSnippets[id]) {
        const updated = { ...newSnippets[id], order };
        newSnippets[id] = updated;
        saveSnippet(updated);
      }
    }
    set({ snippets: newSnippets });
  },

  addComment: (noteId, ideaId, body) => {
    if (!get().hydrated) return "";
    if (!noteId && !ideaId) return "";
    const id = generateId();
    const now = Date.now();
    const comment: Comment = {
      id,
      noteId,
      ideaId,
      body,
      createdAt: now,
      updatedAt: now,
      promotedIdeaId: null,
    };
    set((s) => ({ comments: { ...s.comments, [id]: comment } }));
    saveComment(comment);
    captureEvent("comment_created");
    return id;
  },

  promoteCommentToIdea: (id) => {
    if (!get().hydrated) return "";
    const comment = get().comments[id];
    if (!comment || comment.promotedIdeaId) return "";
    const title = comment.body.trim().slice(0, 80) || "Untitled idea";
    const ideaId = useContentStore.getState().createIdea({ title, summary: comment.body.trim() });
    if (!ideaId) return "";
    const updated: Comment = { ...comment, promotedIdeaId: ideaId, updatedAt: Date.now() };
    set((s) => ({ comments: { ...s.comments, [id]: updated } }));
    saveComment(updated);
    captureEvent("comment_promoted_to_idea");
    return ideaId;
  },

  createVersion: (noteId, _name, trigger) => {
    if (!get().hydrated) return "";
    const note = get().notes[noteId];
    if (!note) return "";
    const { liveEditorNoteId, liveEditorContent } = useAppStore.getState();
    const content =
      liveEditorNoteId === noteId && typeof liveEditorContent === "string"
        ? liveEditorContent
        : note.content;
    const id = generateId();
    const now = Date.now();
    const version: NoteVersion = {
      id,
      noteId,
      title: note.title,
      subtitle: note.subtitle ?? "",
      content,
      goal: note.goal,
      audience: note.audience ?? "",
      tone: note.tone ?? "",
      remember: note.remember ?? "",
      voiceId: note.voiceId,
      name: new Date(now).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      }),
      trigger,
      wordCount: wordCount(content),
      createdAt: now,
    };
    set((s) => ({ versions: { ...s.versions, [id]: version } }));
    saveVersion(version);
    return id;
  },

  removeVersion: (id) => {
    if (!get().hydrated) return;
    const newVersions = { ...get().versions };
    delete newVersions[id];
    set({ versions: newVersions });
    deleteVersionFromDB(id);
  },

  restoreVersion: (versionId) => {
    if (!get().hydrated) return;
    const version = get().versions[versionId];
    if (!version) return;
    const note = get().notes[version.noteId];
    if (!note) return;

    // Safety snapshot before restore
    get().createVersion(note.id, "Before restore", "manual");

    // Restore note to version state
    const updated = {
      ...note,
      title: version.title,
      subtitle: version.subtitle ?? "",
      content: version.content,
      goal: version.goal,
      audience: version.audience ?? "",
      tone: version.tone ?? "",
      remember: version.remember ?? "",
      voiceId: version.voiceId,
      updatedAt: Date.now(),
    };
    set((s) => ({ notes: { ...s.notes, [note.id]: updated } }));
    persistNote(updated);
  },

  duplicateFromVersion: (versionId) => {
    if (!get().hydrated) return "";
    const version = get().versions[versionId];
    if (!version) return "";
    const title = version.title ? `${version.title} copy` : "Untitled copy";
    const id = get().createNote({ title, content: version.content });
    if (id) {
      const note = get().notes[id];
      if (note) {
        const updated = {
          ...note,
          subtitle: version.subtitle ?? "",
          goal: version.goal,
          audience: version.audience ?? "",
          tone: version.tone ?? "",
          remember: version.remember ?? "",
          voiceId: version.voiceId,
        };
        set((s) => ({ notes: { ...s.notes, [id]: updated } }));
        persistNote(updated);
      }
    }
    return id;
  },
}));
