"use client";

import { create } from "zustand";
import {
  pieceContentHome,
  assertIdeaParentAllowed,
  ContractError,
  type ContentPiece,
  type Idea,
  type PieceOrigin,
  type PieceStatus,
  type Priority,
  type PublishRecord,
} from "@/lib/content-engine";
import { generateId } from "@/lib/utils";
import {
  saveIdea as persistIdea,
  savePiece as persistPiece,
  assertPublishGuard,
} from "@/lib/persistence";
import { notifyAgentInboxStatusChange } from "@/lib/agent-inbox/client";

// This is a deliberate deviation from the ticket's "likely extend
// data-store.ts" suggestion: ideas + pieces get their own store file so the
// content-engine diff stays isolated from the notes/snippets diff. See
// CLAUDE.md's worktree-hygiene rule and the ARI-150 execution notes.

// 0 -> 1 -> 2 -> 3 -> 4 -> 0. Distinct from the *sort* rank used in
// content-selectors — this is purely the cycle order for the "bump priority"
// action.
const PRIORITY_CYCLE: readonly Priority[] = [0, 1, 2, 3, 4];

function nextPriority(current: Priority): Priority {
  const index = PRIORITY_CYCLE.indexOf(current);
  return PRIORITY_CYCLE[(index + 1) % PRIORITY_CYCLE.length];
}

export interface CreateIdeaInput {
  title: string;
  summary?: string;
  parentId?: string | null;
  priority?: Priority;
  voiceId?: string;
  origin?: PieceOrigin;
}

export interface CreatePieceInput {
  ideaId: string;
  format: ContentPiece["format"];
  origin: PieceOrigin;
  status?: PieceStatus;
  title?: string;
  noteId?: string;
  body?: string;
  priority?: Priority;
  scheduledAt?: number;
  agentMeta?: ContentPiece["agentMeta"];
  order?: number;
}

interface ContentState {
  ideas: Record<string, Idea>;
  pieces: Record<string, ContentPiece>;
  hydrated: boolean;

  setHydrated: (v: boolean) => void;
  setIdeas: (ideas: Idea[]) => void;
  setPieces: (pieces: ContentPiece[]) => void;

  // Ideas ---------------------------------------------------------------
  createIdea: (input: CreateIdeaInput) => string;
  updateIdea: (id: string, partial: Partial<Pick<Idea, "title" | "summary" | "voiceId">>) => void;
  deleteIdea: (id: string) => void;
  undeleteIdea: (id: string) => void;
  setIdeaPriority: (id: string, priority: Priority) => void;
  cycleIdeaPriority: (id: string) => void;
  pinIdea: (id: string) => void;
  unpinIdea: (id: string) => void;

  // Pieces ----------------------------------------------------------------
  createPiece: (input: CreatePieceInput) => string;
  updatePiece: (id: string, partial: Partial<Omit<ContentPiece, "id" | "createdAt">>) => void;
  reorderPieces: (updates: { id: string; order: number }[]) => void;
  setPieceStatus: (id: string, status: PieceStatus, publish?: PublishRecord) => void;
  markPieceSeen: (id: string) => void;
  setPiecePriority: (id: string, priority: Priority) => void;
  cyclePiecePriority: (id: string) => void;
  rejectPiece: (id: string) => void;
  undeletePiece: (id: string) => void;
  /** In-memory-only tombstone of every piece linking `noteId`, called by
   * data-store's deleteNote after deleteNoteAndSnippets has already
   * persisted the same tombstone in one transaction. */
  detachPieceNote: (noteId: string) => void;
}

export const useContentStore = create<ContentState>((set, get) => ({
  ideas: {},
  pieces: {},
  hydrated: false,

  setHydrated: (v) => set({ hydrated: v }),

  setIdeas: (ideas) => {
    const map: Record<string, Idea> = {};
    for (const idea of ideas) map[idea.id] = idea;
    set({ ideas: map });
  },

  setPieces: (pieces) => {
    const map: Record<string, ContentPiece> = {};
    for (const piece of pieces) map[piece.id] = piece;
    set({ pieces: map });
  },

  createIdea: (input) => {
    if (!get().hydrated) return "";
    const parentId = input.parentId ?? null;
    if (parentId !== null) {
      const parent = get().ideas[parentId];
      if (!parent) throw new ContractError(`parent idea ${parentId} not found`);
      assertIdeaParentAllowed(parent);
    }
    const now = Date.now();
    const idea: Idea = {
      id: generateId(),
      title: input.title,
      summary: input.summary,
      parentId,
      priority: input.priority ?? 0,
      voiceId: input.voiceId,
      origin: input.origin ?? "user",
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ ideas: { ...s.ideas, [idea.id]: idea } }));
    persistIdea(idea);
    return idea.id;
  },

  updateIdea: (id, partial) => {
    if (!get().hydrated) return;
    const idea = get().ideas[id];
    if (!idea) return;
    const updated: Idea = { ...idea, ...partial, updatedAt: Date.now() };
    set((s) => ({ ideas: { ...s.ideas, [id]: updated } }));
    persistIdea(updated);
  },

  deleteIdea: (id) => {
    if (!get().hydrated) return;
    const idea = get().ideas[id];
    if (!idea) return;
    const now = Date.now();
    const updated: Idea = { ...idea, deletedAt: now, updatedAt: now };
    set((s) => ({ ideas: { ...s.ideas, [id]: updated } }));
    persistIdea(updated);
  },

  undeleteIdea: (id) => {
    if (!get().hydrated) return;
    const idea = get().ideas[id];
    if (!idea) return;
    const { deletedAt: _deletedAt, ...rest } = idea;
    const updated: Idea = { ...rest, updatedAt: Date.now() };
    set((s) => ({ ideas: { ...s.ideas, [id]: updated } }));
    persistIdea(updated);
  },

  setIdeaPriority: (id, priority) => {
    if (!get().hydrated) return;
    const idea = get().ideas[id];
    if (!idea) return;
    const updated: Idea = { ...idea, priority, updatedAt: Date.now() };
    set((s) => ({ ideas: { ...s.ideas, [id]: updated } }));
    persistIdea(updated);
  },

  cycleIdeaPriority: (id) => {
    const idea = get().ideas[id];
    if (!idea) return;
    get().setIdeaPriority(id, nextPriority(idea.priority));
  },

  pinIdea: (id) => {
    if (!get().hydrated) return;
    const idea = get().ideas[id];
    if (!idea) return;
    const updated: Idea = { ...idea, pinnedAt: Date.now(), updatedAt: Date.now() };
    set((s) => ({ ideas: { ...s.ideas, [id]: updated } }));
    persistIdea(updated);
  },

  unpinIdea: (id) => {
    if (!get().hydrated) return;
    const idea = get().ideas[id];
    if (!idea) return;
    const { pinnedAt: _pinnedAt, ...rest } = idea;
    const updated: Idea = { ...rest, updatedAt: Date.now() };
    set((s) => ({ ideas: { ...s.ideas, [id]: updated } }));
    persistIdea(updated);
  },

  createPiece: (input) => {
    if (!get().hydrated) return "";
    const now = Date.now();
    const siblingMaxOrder = Object.values(get().pieces)
      .filter((p) => p.ideaId === input.ideaId)
      .reduce((max, p) => Math.max(max, p.order), -1);
    const piece: ContentPiece = {
      id: generateId(),
      ideaId: input.ideaId,
      format: input.format,
      status: input.status ?? "inbox",
      origin: input.origin,
      title: input.title,
      noteId: input.noteId,
      body: input.body,
      seen: false,
      priority: input.priority ?? 0,
      order: input.order ?? siblingMaxOrder + 1,
      scheduledAt: input.scheduledAt,
      agentMeta: input.agentMeta,
      createdAt: now,
      updatedAt: now,
    };
    pieceContentHome(piece);
    assertPublishGuard(piece);
    set((s) => ({ pieces: { ...s.pieces, [piece.id]: piece } }));
    persistPiece(piece);
    return piece.id;
  },

  updatePiece: (id, partial) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const updated: ContentPiece = { ...piece, ...partial, updatedAt: Date.now() };
    pieceContentHome(updated);
    assertPublishGuard(updated);
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  reorderPieces: (updates) => {
    if (!get().hydrated) return;
    const pieces = { ...get().pieces };
    for (const { id, order } of updates) {
      if (pieces[id]) {
        const updated = { ...pieces[id], order };
        pieces[id] = updated;
        persistPiece(updated);
      }
    }
    set({ pieces });
  },

  setPieceStatus: (id, status, publish) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const updated: ContentPiece = {
      ...piece,
      status,
      publish: status === "published" ? (publish ?? piece.publish) : undefined,
      // Any explicit status change resolves a pending "awaiting
      // confirmation" Substack attempt — the verification loop, a manual
      // "Mark as published…", or just moving the piece back a stage all
      // count as resolution. See publishPendingState in
      // src/lib/publish/substack-verify.ts for the badge this backs.
      publishAttemptedAt: undefined,
      updatedAt: Date.now(),
    };
    assertPublishGuard(updated);
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
    // Best-effort — let any agent watching the inbox's .status.jsonl see
    // the two status changes it would actually care about.
    if (status === "ready" || status === "published") {
      notifyAgentInboxStatusChange(id, status);
    }
  },

  markPieceSeen: (id) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece || piece.seen) return;
    const updated: ContentPiece = { ...piece, seen: true, updatedAt: Date.now() };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  setPiecePriority: (id, priority) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const updated: ContentPiece = { ...piece, priority, updatedAt: Date.now() };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  cyclePiecePriority: (id) => {
    const piece = get().pieces[id];
    if (!piece) return;
    get().setPiecePriority(id, nextPriority(piece.priority));
  },

  rejectPiece: (id) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const now = Date.now();
    const updated: ContentPiece = { ...piece, deletedAt: now, updatedAt: now };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  undeletePiece: (id) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const { deletedAt: _deletedAt, ...rest } = piece;
    const updated: ContentPiece = { ...rest, updatedAt: Date.now() };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  detachPieceNote: (noteId) => {
    const now = Date.now();
    set((s) => {
      const pieces = { ...s.pieces };
      for (const [id, piece] of Object.entries(pieces)) {
        if (piece.noteId === noteId && piece.deletedAt === undefined) {
          pieces[id] = { ...piece, deletedAt: now, updatedAt: now };
        }
      }
      return { pieces };
    });
  },
}));
