"use client";

import { create } from "zustand";
import {
  assertIdeaParentAllowed,
  ContractError,
  type ContentFormat,
  type ContentPiece,
  type Idea,
  type PieceOrigin,
  type PieceStatus,
  type Priority,
  type PublishRecord,
  type Resource,
  type ResourceInput,
  type ResourceOwnerType,
} from "@/lib/content-engine";
import { generateId } from "@/lib/utils";
import {
  saveIdea as persistIdea,
  savePiece as persistPiece,
  saveResource as persistResource,
  deleteResourceRow,
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
  /**
   * Required, with no default, on purpose.
   *
   * "inbox" means one thing: this arrived from somewhere other than the
   * person sitting here. Agent pushes land there, and the import pipeline
   * writes them straight to the store, so nothing reaching THIS function is
   * ever an inbox item. While the field was optional and defaulted to
   * "inbox", three call sites forgot to pass it and quietly filed the
   * writer's own work in the agent tray, where the triage strip then asked
   * whether they wanted to pick up their own writing.
   *
   * A default cannot express that rule. Asking every caller can.
   */
  status: PieceStatus;
  title?: string;
  /** Defaults to "": a fragment always has a body, even an empty one. */
  body?: string;
  priority?: Priority;
  scheduledAt?: number;
  agentMeta?: ContentPiece["agentMeta"];
  order?: number;
  /** Defaults to false (the unseen dot is for pieces that arrived on their
   * own). Pieces the user just created by hand start seen. */
  seen?: boolean;
}

/** The ids a cascading idea delete touched, enough to undo it exactly. */
export interface IdeaCascade {
  ideaIds: string[];
  pieceIds: string[];
}

interface ContentState {
  ideas: Record<string, Idea>;
  pieces: Record<string, ContentPiece>;
  resources: Record<string, Resource>;
  hydrated: boolean;
  /**
   * True when the initial IndexedDB read of ideas/pieces/resources threw, so
   * the empty maps above mean "unknown", not "nothing". Anything whose
   * correctness depends on knowing what already exists must refuse to run
   * while this is set — above all the agent-inbox importer, which would treat
   * every pending handoff as new, re-insert it at its file status, and then
   * ack the source markdown out of the inbox for good.
   */
  loadFailed: boolean;

  setHydrated: (v: boolean) => void;
  setLoadFailed: (v: boolean) => void;
  setIdeas: (ideas: Idea[]) => void;
  setPieces: (pieces: ContentPiece[]) => void;
  setResources: (resources: Resource[]) => void;

  // Ideas ---------------------------------------------------------------
  createIdea: (input: CreateIdeaInput) => string;
  updateIdea: (
    id: string,
    partial: Partial<
      Pick<Idea, "title" | "summary" | "voiceId" | "goal" | "audience" | "tone" | "remember">
    >,
  ) => void;
  deleteIdea: (id: string) => void;
  undeleteIdea: (id: string) => void;
  /** Tombstone an idea together with everything only reachable through it: its
   * child ideas and every fragment owned by any of them. Returns the ids it
   * touched so the caller can offer an exact undo (restoreIdeaCascade).
   * Deleting the idea alone would strand its children: the sidebar renders
   * ideas from the roots down, so a child whose parent is gone is invisible
   * but still there. The same is now true of the fragments, which is why they
   * go with it. A fragment holds its own text and has no home outside its
   * idea, so leaving one behind would hide it rather than spare it. */
  deleteIdeaCascade: (id: string) => IdeaCascade;
  restoreIdeaCascade: (cascade: IdeaCascade) => void;
  setIdeaPriority: (id: string, priority: Priority) => void;
  cycleIdeaPriority: (id: string) => void;
  pinIdea: (id: string) => void;
  unpinIdea: (id: string) => void;
  /** Put an idea away with everything under it: child ideas and every
   * fragment they own. Same reach as deleteIdeaCascade and for the same
   * reason (a child whose parent left the list is invisible but still there),
   * and it returns the ids it stamped so unarchiving lifts exactly those.
   * Anything already archived on its own stays out of the returned set, so
   * restoring the idea does not drag back a piece the writer put away
   * separately. */
  archiveIdeaCascade: (id: string) => IdeaCascade;
  restoreIdeaArchive: (archive: IdeaCascade) => void;

  // Pieces ----------------------------------------------------------------
  createPiece: (input: CreatePieceInput) => string;
  /** Create an idea and its first fragment in one step, and return both ids.
   * Every fragment belongs to an idea, so "start writing something new" is
   * always these two writes; making it one call is what stops the sidebar
   * from having to know that. */
  createIdeaWithFragment: (input?: {
    title?: string;
    body?: string;
    format?: ContentFormat;
  }) => { ideaId: string; pieceId: string };
  updatePiece: (id: string, partial: Partial<Omit<ContentPiece, "id" | "createdAt">>) => void;
  reorderPieces: (updates: { id: string; order: number }[]) => void;
  setPieceStatus: (id: string, status: PieceStatus, publish?: PublishRecord) => void;
  markPieceSeen: (id: string) => void;
  setPiecePriority: (id: string, priority: Priority) => void;
  cyclePiecePriority: (id: string) => void;
  rejectPiece: (id: string) => void;
  undeletePiece: (id: string) => void;
  /** Put one fragment away. No cascade: a fragment owns nothing but its own
   * snips, and those are already scoped to it. */
  archivePiece: (id: string) => void;
  unarchivePiece: (id: string) => void;
  pinPiece: (id: string) => void;
  unpinPiece: (id: string) => void;
  /** Tombstone a fragment, leaving the snips cut out of it in place, and
   * return the id of the next fragment in the same idea to select, or null
   * when that was the last one. The caller is usually looking at what it just deleted, so it
   * needs somewhere to go; picking the successor here keeps that answer in one
   * place instead of in every surface that can delete. */
  deletePieceCascade: (id: string) => string | null;
  /** Undo half of deletePieceCascade. Restores the fragment and, with it, the
   * snips cut from it, which were never removed. */
  restorePieceCascade: (id: string) => void;

  // Resources ---------------------------------------------------------------
  /** Add a resource directly owned by an idea or a piece. Never copies an
   * inherited resource — see effectiveResourcesForIdea/Piece in
   * resources-selectors.ts for how inheritance is composed at read time. */
  addResource: (ownerType: ResourceOwnerType, ownerId: string, input: ResourceInput) => string;
  /** Hard delete — Resource has no tombstone field, unlike Idea/ContentPiece. */
  removeResource: (id: string) => void;
  listResources: () => Resource[];
}

export const useContentStore = create<ContentState>((set, get) => ({
  ideas: {},
  pieces: {},
  resources: {},
  hydrated: false,
  loadFailed: false,

  setHydrated: (v) => set({ hydrated: v }),
  setLoadFailed: (v) => set({ loadFailed: v }),

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

  setResources: (resources) => {
    const map: Record<string, Resource> = {};
    for (const resource of resources) map[resource.id] = resource;
    set({ resources: map });
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

  deleteIdeaCascade: (id) => {
    const empty: IdeaCascade = { ideaIds: [], pieceIds: [] };
    if (!get().hydrated) return empty;
    const idea = get().ideas[id];
    if (!idea) return empty;

    // Depth is capped at 2 by the contract, so one pass over the children is
    // the whole subtree below `id`.
    const ideaIds = [id];
    for (const candidate of Object.values(get().ideas)) {
      if (candidate.parentId === id && candidate.deletedAt === undefined) {
        ideaIds.push(candidate.id);
      }
    }
    const owned = new Set(ideaIds);
    const pieceIds = Object.values(get().pieces)
      .filter((piece) => piece.deletedAt === undefined && owned.has(piece.ideaId))
      .map((piece) => piece.id);

    const now = Date.now();
    set((s) => {
      const ideas = { ...s.ideas };
      for (const ideaId of ideaIds) {
        const updated: Idea = { ...ideas[ideaId], deletedAt: now, updatedAt: now };
        ideas[ideaId] = updated;
        persistIdea(updated);
      }
      const pieces = { ...s.pieces };
      for (const pieceId of pieceIds) {
        const updated: ContentPiece = { ...pieces[pieceId], deletedAt: now, updatedAt: now };
        pieces[pieceId] = updated;
        persistPiece(updated);
      }
      return { ideas, pieces };
    });

    return { ideaIds, pieceIds };
  },

  restoreIdeaCascade: (cascade) => {
    if (!get().hydrated) return;
    const now = Date.now();
    set((s) => {
      const ideas = { ...s.ideas };
      for (const ideaId of cascade.ideaIds) {
        const idea = ideas[ideaId];
        if (!idea) continue;
        const { deletedAt: _deletedAt, ...rest } = idea;
        const updated: Idea = { ...rest, updatedAt: now };
        ideas[ideaId] = updated;
        persistIdea(updated);
      }
      const pieces = { ...s.pieces };
      for (const pieceId of cascade.pieceIds) {
        const piece = pieces[pieceId];
        if (!piece) continue;
        const { deletedAt: _deletedAt, ...rest } = piece;
        const updated: ContentPiece = { ...rest, updatedAt: now };
        pieces[pieceId] = updated;
        persistPiece(updated);
      }
      return { ideas, pieces };
    });
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

  archiveIdeaCascade: (id) => {
    const empty: IdeaCascade = { ideaIds: [], pieceIds: [] };
    if (!get().hydrated) return empty;
    const idea = get().ideas[id];
    if (!idea || idea.deletedAt !== undefined) return empty;

    const ideaIds = idea.archivedAt === undefined ? [id] : [];
    for (const candidate of Object.values(get().ideas)) {
      if (
        candidate.parentId === id &&
        candidate.deletedAt === undefined &&
        candidate.archivedAt === undefined
      ) {
        ideaIds.push(candidate.id);
      }
    }
    // The pieces of every idea going away, including this one's own even when
    // the idea itself was already archived — reaching them is the point.
    const owned = new Set<string>([id, ...ideaIds]);
    const pieceIds = Object.values(get().pieces)
      .filter(
        (piece) =>
          piece.deletedAt === undefined &&
          piece.archivedAt === undefined &&
          owned.has(piece.ideaId),
      )
      .map((piece) => piece.id);

    if (ideaIds.length === 0 && pieceIds.length === 0) return empty;

    const now = Date.now();
    set((s) => {
      const ideas = { ...s.ideas };
      for (const ideaId of ideaIds) {
        const updated: Idea = { ...ideas[ideaId], archivedAt: now, updatedAt: now };
        ideas[ideaId] = updated;
        persistIdea(updated);
      }
      const pieces = { ...s.pieces };
      for (const pieceId of pieceIds) {
        const updated: ContentPiece = { ...pieces[pieceId], archivedAt: now, updatedAt: now };
        pieces[pieceId] = updated;
        persistPiece(updated);
      }
      return { ideas, pieces };
    });

    return { ideaIds, pieceIds };
  },

  restoreIdeaArchive: (archive) => {
    if (!get().hydrated) return;
    const now = Date.now();
    set((s) => {
      const ideas = { ...s.ideas };
      for (const ideaId of archive.ideaIds) {
        const idea = ideas[ideaId];
        if (!idea) continue;
        const { archivedAt: _archivedAt, ...rest } = idea;
        const updated: Idea = { ...rest, updatedAt: now };
        ideas[ideaId] = updated;
        persistIdea(updated);
      }
      const pieces = { ...s.pieces };
      for (const pieceId of archive.pieceIds) {
        const piece = pieces[pieceId];
        if (!piece) continue;
        const { archivedAt: _archivedAt, ...rest } = piece;
        const updated: ContentPiece = { ...rest, updatedAt: now };
        pieces[pieceId] = updated;
        persistPiece(updated);
      }
      return { ideas, pieces };
    });
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
      status: input.status,
      origin: input.origin,
      title: input.title,
      body: input.body ?? "",
      seen: input.seen ?? false,
      priority: input.priority ?? 0,
      order: input.order ?? siblingMaxOrder + 1,
      scheduledAt: input.scheduledAt,
      agentMeta: input.agentMeta,
      createdAt: now,
      updatedAt: now,
    };
    assertPublishGuard(piece);
    set((s) => ({ pieces: { ...s.pieces, [piece.id]: piece } }));
    persistPiece(piece);
    return piece.id;
  },

  createIdeaWithFragment: (input) => {
    const nothing = { ideaId: "", pieceId: "" };
    if (!get().hydrated) return nothing;
    const title = input?.title ?? "";
    const ideaId = get().createIdea({ title });
    if (!ideaId) return nothing;
    const pieceId = get().createPiece({
      ideaId,
      // Long-form by default: the empty fragment a writer is handed opens in
      // the editor, not as a card in the feed. Format is shape only, so
      // changing it later moves the fragment between surfaces and nothing else.
      format: input?.format ?? "essay",
      origin: "user",
      // Something you made by hand is already picked up; the inbox is for
      // fragments that arrived on their own.
      status: "in-progress",
      title: title || undefined,
      body: input?.body ?? "",
      seen: true,
    });
    return { ideaId, pieceId };
  },

  updatePiece: (id, partial) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const updated: ContentPiece = { ...piece, ...partial, updatedAt: Date.now() };
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

  archivePiece: (id) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const now = Date.now();
    const updated: ContentPiece = { ...piece, archivedAt: now, updatedAt: now };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  unarchivePiece: (id) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const { archivedAt: _archivedAt, ...rest } = piece;
    const updated: ContentPiece = { ...rest, updatedAt: Date.now() };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  pinPiece: (id) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const now = Date.now();
    const updated: ContentPiece = { ...piece, pinnedAt: now, updatedAt: now };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  unpinPiece: (id) => {
    if (!get().hydrated) return;
    const piece = get().pieces[id];
    if (!piece) return;
    const { pinnedAt: _pinnedAt, ...rest } = piece;
    const updated: ContentPiece = { ...rest, updatedAt: Date.now() };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));
    persistPiece(updated);
  },

  deletePieceCascade: (id) => {
    if (!get().hydrated) return null;
    const piece = get().pieces[id];
    if (!piece) return null;

    const now = Date.now();
    const updated: ContentPiece = { ...piece, deletedAt: now, updatedAt: now };
    set((s) => ({ pieces: { ...s.pieces, [id]: updated } }));

    // The snips stay. Deleting a fragment is a tombstone, and a tombstone is
    // reversible, so destroying its snips in the same breath would make undo a
    // half-measure: the words come back and the cuttings the writer kept beside
    // them do not. They are already invisible while the fragment is, because
    // every snip surface is scoped to a fragment or an idea, so leaving the
    // rows costs nothing a writer can see and makes restore whole.
    persistPiece(updated);

    // Where to look next: the idea's remaining fragments in the order the UI
    // lists them, so the selection lands where the eye already is.
    const next = Object.values(get().pieces)
      .filter((p) => p.id !== id && p.ideaId === piece.ideaId && p.deletedAt === undefined)
      .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt)[0];
    return next?.id ?? null;
  },

  restorePieceCascade: (id) => {
    // Lifting the tombstone restores everything, because nothing else was
    // taken away: the snips were left in place precisely so this is true.
    get().undeletePiece(id);
  },

  addResource: (ownerType, ownerId, input) => {
    if (!get().hydrated) return "";
    const resource: Resource = {
      id: generateId(),
      ownerType,
      ownerId,
      kind: input.kind,
      url: input.url,
      title: input.title,
      note: input.note,
      createdAt: Date.now(),
    };
    set((s) => ({ resources: { ...s.resources, [resource.id]: resource } }));
    persistResource(resource);
    return resource.id;
  },

  removeResource: (id) => {
    if (!get().hydrated) return;
    if (!get().resources[id]) return;
    set((s) => {
      const resources = { ...s.resources };
      delete resources[id];
      return { resources };
    });
    deleteResourceRow(id);
  },

  listResources: () => Object.values(get().resources),
}));
