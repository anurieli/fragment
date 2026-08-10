"use client";

import { create } from "zustand";
import type { Snippet, PieceVersion, VersionTrigger, Comment } from "@/lib/types";
import { generateId, wordCount } from "@/lib/utils";
import { snipHomeKey, snippetHome } from "@/lib/snip-scope";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import {
  saveSnippet,
  deleteSnippet as deleteSnippetFromDB,
  savePieceVersion,
  deletePieceVersion as deletePieceVersionFromDB,
  saveComment,
} from "@/lib/persistence";
import { captureEvent } from "@/lib/posthog";

/**
 * The satellites of a fragment: the snips cut out of it and the versions
 * snapshotted from it. The fragment itself lives in the content store, which
 * is why this file reads it rather than holding a copy: two stores holding the
 * same text is how they drift.
 */
interface DataState {
  snippets: Record<string, Snippet>;
  versions: Record<string, PieceVersion>;
  comments: Record<string, Comment>;
  hydrated: boolean;

  // "Awaiting confirmation" state for the Substack verified-publish loop:
  // pieceId -> the epoch ms a "Publish to Substack" attempt fired from the
  // editor. Deliberately NOT persisted to Dexie (or anywhere else): it is a
  // transient UI signal that a fresh 3-min poll
  // (use-publish-verification.ts) or the user's next explicit action
  // naturally resolves, losing it on reload just means the badge disappears,
  // and a genuinely stuck attempt is still visible via Substack itself. The
  // feed's publish path stamps ContentPiece.publishAttemptedAt instead, which
  // is persisted because a card has to still look pending tomorrow.
  pendingSubstackPublish: Record<string, number>;

  setHydrated: (v: boolean) => void;
  setSnippets: (snippets: Snippet[]) => void;
  setVersions: (versions: PieceVersion[]) => void;
  setComments: (comments: Comment[]) => void;
  markPiecePublishPending: (pieceId: string) => void;
  clearPiecePublishPending: (pieceId: string) => void;

  /** pieceId null files the snippet against the idea instead (a snip taken
   * somewhere other than inside one fragment's text). */
  addSnippet: (pieceId: string | null, content: string, atIndex?: number, ideaId?: string) => string;
  updateSnippetLabel: (
    id: string,
    label: string | null,
    status: Snippet["labelStatus"],
  ) => void;
  /** Rewrite a snip's words in place. The label is left alone here: it is the
   * caller who knows whether the change deserves a fresh one (see
   * snippet-card.tsx, which re-labels an edited snip). */
  updateSnippetContent: (id: string, content: string) => void;
  removeSnippet: (id: string) => void;
  restoreSnippet: (snippet: Snippet) => void;
  reorderSnippets: (updates: { id: string; order: number }[]) => void;

  /** Adds a comment against whichever home is passed (exactly one of pieceId
   * / ideaId — see commentHome in comment-scope.ts). Empty when neither is
   * set, mirroring addSnippet's homeless refusal. */
  addComment: (pieceId: string | null, ideaId: string | null, body: string) => string;
  /** Creates an Idea seeded from the comment's body (via content-store's
   * createIdea) and stamps the comment's promotedIdeaId with it. The comment
   * stays put — this is a forward pointer, not a move. Returns the new
   * idea's id, or "" if the comment is missing or already promoted. */
  promoteCommentToIdea: (id: string) => string;

  createVersion: (pieceId: string, name: string, trigger: VersionTrigger) => string;
  removeVersion: (id: string) => void;
  restoreVersion: (versionId: string) => void;
  duplicateFromVersion: (versionId: string) => string;
}

export const useDataStore = create<DataState>((set, get) => ({
  snippets: {},
  versions: {},
  comments: {},
  hydrated: false,
  pendingSubstackPublish: {},

  setHydrated: (v) => set({ hydrated: v }),

  markPiecePublishPending: (pieceId) => {
    set((s) => ({ pendingSubstackPublish: { ...s.pendingSubstackPublish, [pieceId]: Date.now() } }));
  },

  clearPiecePublishPending: (pieceId) => {
    set((s) => {
      if (!(pieceId in s.pendingSubstackPublish)) return s;
      const next = { ...s.pendingSubstackPublish };
      delete next[pieceId];
      return { pendingSubstackPublish: next };
    });
  },

  setSnippets: (snippets) => {
    const map: Record<string, Snippet> = {};
    for (const s of snippets) map[s.id] = s;
    set({ snippets: map });
  },

  setVersions: (versions) => {
    const map: Record<string, PieceVersion> = {};
    for (const v of versions) map[v.id] = v;
    set({ versions: map });
  },

  setComments: (comments) => {
    const map: Record<string, Comment> = {};
    for (const c of comments) map[c.id] = c;
    set({ comments: map });
  },

  addComment: (pieceId, ideaId, body) => {
    if (!get().hydrated) return "";
    if (!pieceId && !ideaId) return "";
    const id = generateId();
    const now = Date.now();
    const comment: Comment = {
      id,
      pieceId,
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

  addSnippet: (pieceId, content, atIndex?, ideaId?) => {
    if (!get().hydrated) return "";
    // A snippet with neither home would be written to disk and never loaded
    // back (the store holds a window keyed on fragment and idea), so refuse it
    // here rather than lose it later.
    const home = snipHomeKey(pieceId, ideaId);
    if (!home) return "";
    const id = generateId();
    // `order` runs within a home, not across the whole table; see
    // snip-scope.ts. Two homes can be on screen together; their orders
    // interleave in the bar and createdAt breaks the ties.
    const existingSnippets = Object.values(get().snippets)
      .filter((s) => snippetHome(s) === home)
      .sort((a, b) => a.order - b.order);

    let order: number;
    if (atIndex !== undefined && atIndex < existingSnippets.length) {
      // Insert at specific position: shift all snippets at or after this index
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
        // Snippet.noteId survives as a column for rows written before the
        // switchover; nothing created from here fills it in again.
        noteId: null,
        pieceId: pieceId ?? undefined,
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
        noteId: null,
        pieceId: pieceId ?? undefined,
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

  updateSnippetContent: (id, content) => {
    if (!get().hydrated) return;
    const snippet = get().snippets[id];
    if (!snippet) return;
    const updated = { ...snippet, content };
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

  createVersion: (pieceId, _name, trigger) => {
    if (!get().hydrated) return "";
    const piece = useContentStore.getState().pieces[pieceId];
    if (!piece) return "";
    // The editor holds keystrokes for a beat before they reach the store, so a
    // snapshot taken mid-sentence has to read the live buffer or it records
    // the text as it was a moment ago rather than as the writer sees it.
    const { liveEditorPieceId, liveEditorContent } = useAppStore.getState();
    const content =
      liveEditorPieceId === pieceId && typeof liveEditorContent === "string"
        ? liveEditorContent
        : piece.body;
    const id = generateId();
    const now = Date.now();
    // The name argument is kept for callers that describe why they snapshotted
    // ("Before restore"), but the timeline labels every entry by when it was
    // taken, which is what a writer scans for.
    const version: PieceVersion = {
      id,
      pieceId,
      title: piece.title ?? "",
      subtitle: piece.subtitle ?? "",
      content,
      goal: piece.goal ?? "",
      audience: piece.audience ?? "",
      tone: piece.tone ?? "",
      remember: piece.remember ?? "",
      voiceId: piece.voiceId,
      name: new Date(now).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      }),
      trigger,
      wordCount: wordCount(content),
      createdAt: now,
    };
    set((s) => ({ versions: { ...s.versions, [id]: version } }));
    savePieceVersion(version);
    return id;
  },

  removeVersion: (id) => {
    if (!get().hydrated) return;
    const newVersions = { ...get().versions };
    delete newVersions[id];
    set({ versions: newVersions });
    deletePieceVersionFromDB(id);
  },

  restoreVersion: (versionId) => {
    if (!get().hydrated) return;
    const version = get().versions[versionId];
    if (!version) return;
    const content = useContentStore.getState();
    if (!content.pieces[version.pieceId]) return;

    // Safety snapshot before restore: restoring is itself a destructive edit,
    // and the writer has to be able to undo it from the same timeline.
    get().createVersion(version.pieceId, "Before restore", "manual");

    content.updatePiece(version.pieceId, {
      title: version.title,
      subtitle: version.subtitle ?? "",
      body: version.content,
      goal: version.goal,
      audience: version.audience ?? "",
      tone: version.tone ?? "",
      remember: version.remember ?? "",
      voiceId: version.voiceId,
    });
  },

  duplicateFromVersion: (versionId) => {
    if (!get().hydrated) return "";
    const version = get().versions[versionId];
    if (!version) return "";
    const content = useContentStore.getState();
    const source = content.pieces[version.pieceId];
    // The copy lands in the idea it came out of. A version belongs to a
    // fragment, a fragment belongs to an idea, and there is no standalone
    // shelf left to drop it on.
    if (!source) return "";

    const pieceId = content.createPiece({
      ideaId: source.ideaId,
      format: source.format,
      origin: "user",
      status: "in-progress",
      title: version.title ? `${version.title} copy` : "Untitled copy",
      body: version.content,
      seen: true,
    });
    if (!pieceId) return "";

    // The brief travels with the words: a copy you have to re-brief is a copy
    // that drafts differently from the one you copied. createPiece takes only
    // the fields every fragment is born with, so the rest follows here.
    content.updatePiece(pieceId, {
      subtitle: version.subtitle ?? "",
      goal: version.goal,
      audience: version.audience ?? "",
      tone: version.tone ?? "",
      remember: version.remember ?? "",
      voiceId: version.voiceId,
    });
    return pieceId;
  },
}));
