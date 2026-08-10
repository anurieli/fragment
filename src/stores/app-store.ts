"use client";

import { create } from "zustand";
import type { Snippet, AIProvider } from "@/lib/types";
import type { PanelSection } from "@/lib/piece-section";

interface PendingSnippetDrop {
  snippet: Snippet;
  editorFrom: number;
  editorTo: number;
  cancelled: boolean;
}

interface FloatingDragCard {
  content: string;
  label: string | null;
  /** "idle": nothing is being fetched — a drag that labels only on drop. */
  labelStatus: "idle" | "loading" | "done" | "error";
}

interface PanelDrag {
  pieceId: string;
  /** The list it was picked up from, so only the other one invites a drop. */
  from: PanelSection;
}

interface PendingEditorDeletion {
  from: number;
  to: number;
  snippetId?: string;
}

/**
 * Text on its way into the editor from the right-hand bar, set by a card's
 * custom drag and consumed by the editor.
 *
 * `snippetId` is null when the text did not come from a snip: dragging one of
 * the idea's other pieces into the draft copies its words in and leaves the
 * piece itself alone, so there is nothing to remove and nothing to offer an
 * undo for. A snip, by contrast, moves.
 */
interface PendingSnippetInsert {
  snippetId: string | null;
  content: string;
  /** Pointer coordinates for drag/drop. Omitted by the context-menu action,
   * which inserts at the editor's current selection. */
  clientX?: number;
  clientY?: number;
}

/** Which writing space the editor toolbar shows for the active idea. */
export type IdeaSpace = "write" | "pieces";

interface AppState {
  sidebarOpen: boolean;
  /** True when the sidebar was opened deliberately rather than peeked at.
   * A peeked sidebar overlays and retracts on mouse-out; a pinned one holds
   * the column open. Mirrors helperBarOpen / helperBarPinned. */
  sidebarPinned: boolean;
  helperBarOpen: boolean;
  helperBarPinned: boolean;
  timelineOpen: boolean;
  /** The bottom Comments panel — pops up over the editor, toggled from the
   * sidebar. Independent of the side panels above; both can be open at once. */
  commentsPanelOpen: boolean;
  timelinePreviewVersionId: string | null;
  activePieceId: string | null;
  /** The idea selected in the sidebar, if any. Independent of activePieceId:
   * an idea's Write space opens one of its own long-form fragments, and the
   * sidebar can have an idea selected with no fragment open at all. */
  activeIdeaId: string | null;
  /** Per-idea Write/Pieces choice, persisted in-session (see ARI-154 §2). Missing entries default to "write". */
  ideaSpaces: Record<string, IdeaSpace>;
  /** The idea workspace column between the sidebar and the editor. Only ever
   * rendered when an idea is open; this is the user's collapse preference. */
  ideaPanelOpen: boolean;
  /** One-shot "jump to this piece" request from the idea workspace to the
   * pieces feed: the feed focuses it, scrolls it into view, and clears this. */
  revealPieceId: string | null;
  /** Which piece the feed currently has roving focus on, and which one the
   * pointer is over. Published here rather than kept local to the feed so the
   * idea workspace can show you where you are without owning the feed's
   * state. Both are null whenever the Pieces space isn't showing. */
  focusedPieceId: string | null;
  hoveredPieceId: string | null;
  liveEditorPieceId: string | null;
  liveEditorContent: string | null;
  isDraggingToHelper: boolean;
  isDraggingToEditor: boolean;
  /** A row being dragged between the idea panel's two lists. Held in the store
   * rather than in the panel because the drop zone that has to light up is a
   * sibling of the row, not a child of it. Null whenever nothing is moving. */
  panelDrag: PanelDrag | null;
  pendingSnippetDrop: PendingSnippetDrop | null;
  pendingEditorDeletion: PendingEditorDeletion | null;
  floatingDragCard: FloatingDragCard | null;
  showCreationFlow: boolean;
  generatingPieceId: string | null;
  streamingContent: string | null;
  streamingError: string | null;
  isFeedbackOpen: boolean;
  contextPromptDismissedPieces: Set<string>;
  /** Live status of the "Sign in with ChatGPT" (Codex) session. */
  codexConnection: "connected" | "refreshing" | "disconnected";
  /** Transient per-voice analysis status (not persisted). */
  voiceAnalysisStatus: Record<string, "analyzing" | "error">;
  /** Open when an AI feature is invoked with no working provider, or a live call rejects the credential. Null = closed. */
  aiGate: { reason: "no-provider" | "auth-failed"; provider?: AIProvider } | null;
  /** Providers that failed a live call this session — cleared on a fresh connect or app relaunch. */
  badProviders: Set<AIProvider>;

  setVoiceAnalysisStatus: (voiceId: string, status: "analyzing" | "error" | null) => void;
  setCodexConnection: (status: "connected" | "refreshing" | "disconnected") => void;
  openAiGate: (reason: "no-provider" | "auth-failed", provider?: AIProvider) => void;
  closeAiGate: () => void;
  markProviderBad: (provider: AIProvider) => void;
  clearProviderBad: (provider: AIProvider) => void;
  openFeedback: () => void;
  closeFeedback: () => void;
  toggleSidebar: () => void;
  /** Peek: show it without pinning. Used by the rail's hover. */
  peekSidebar: (v: boolean) => void;
  /** Pin it open. What the rail's button does — it cannot toggle, because
   * hovering the rail to reach the button has already peeked it open, and a
   * toggle would read that as "open" and close it. */
  pinSidebar: () => void;
  toggleHelperBar: () => void;
  toggleTimeline: () => void;
  toggleCommentsPanel: () => void;
  setSidebarOpen: (v: boolean) => void;
  setHelperBarOpen: (v: boolean) => void;
  pinHelperBar: () => void;
  closeHelperBar: () => void;
  setCommentsPanelOpen: (v: boolean) => void;
  closeCommentsPanel: () => void;
  setTimelineOpen: (v: boolean) => void;
  setTimelinePreviewVersionId: (id: string | null) => void;
  setActivePiece: (id: string | null) => void;
  setActiveIdea: (id: string | null) => void;
  setIdeaSpace: (ideaId: string, space: IdeaSpace) => void;
  toggleIdeaSpace: (ideaId: string) => void;
  setIdeaPanelOpen: (v: boolean) => void;
  toggleIdeaPanel: () => void;
  revealPiece: (id: string) => void;
  clearRevealPiece: () => void;
  setFocusedPiece: (id: string | null) => void;
  setHoveredPiece: (id: string | null) => void;
  setShowCreationFlow: (v: boolean) => void;
  setGeneratingPiece: (id: string | null) => void;
  setStreamingContent: (content: string | null) => void;
  setStreamingError: (error: string | null) => void;
  dismissContextPrompt: (pieceId: string) => void;
  setLiveEditorContent: (pieceId: string, content: string) => void;
  setDraggingToHelper: (v: boolean) => void;
  setDraggingToEditor: (v: boolean) => void;
  setPanelDrag: (v: PanelDrag | null) => void;
  setPendingSnippetDrop: (v: PendingSnippetDrop | null) => void;
  commitPendingDrop: () => void;
  cancelPendingDrop: () => void;
  setPendingEditorDeletion: (v: PendingEditorDeletion | null) => void;
  setFloatingDragCard: (v: FloatingDragCard | null) => void;
  updateFloatingCardLabel: (label: string | null, status: FloatingDragCard["labelStatus"]) => void;
  pendingSnippetInsert: PendingSnippetInsert | null;
  setPendingSnippetInsert: (v: PendingSnippetInsert | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sidebarOpen: true,
  sidebarPinned: true,
  helperBarOpen: false,
  helperBarPinned: false,
  timelineOpen: false,
  commentsPanelOpen: false,
  timelinePreviewVersionId: null,
  activePieceId: null,
  activeIdeaId: null,
  ideaSpaces: {},
  ideaPanelOpen: true,
  revealPieceId: null,
  focusedPieceId: null,
  hoveredPieceId: null,
  liveEditorPieceId: null,
  liveEditorContent: null,
  isDraggingToHelper: false,
  isDraggingToEditor: false,
  panelDrag: null,
  pendingSnippetDrop: null,
  pendingEditorDeletion: null,
  floatingDragCard: null,
  pendingSnippetInsert: null,
  showCreationFlow: false,
  generatingPieceId: null,
  streamingContent: null,
  streamingError: null,
  isFeedbackOpen: false,
  contextPromptDismissedPieces: new Set(),
  codexConnection: "connected",
  voiceAnalysisStatus: {},
  aiGate: null,
  badProviders: new Set(),

  setVoiceAnalysisStatus: (voiceId, status) => set((s) => {
    const next = { ...s.voiceAnalysisStatus };
    if (status === null) delete next[voiceId];
    else next[voiceId] = status;
    return { voiceAnalysisStatus: next };
  }),
  setCodexConnection: (status) => set({ codexConnection: status }),
  openAiGate: (reason, provider) => {
    set({ aiGate: { reason, provider } });
  },
  closeAiGate: () => set({ aiGate: null }),
  markProviderBad: (provider) => set((s) => {
    if (s.badProviders.has(provider)) return {};
    const next = new Set(s.badProviders);
    next.add(provider);
    return { badProviders: next };
  }),
  clearProviderBad: (provider) => set((s) => {
    if (!s.badProviders.has(provider)) return {};
    const next = new Set(s.badProviders);
    next.delete(provider);
    return { badProviders: next };
  }),
  openFeedback: () => set({ isFeedbackOpen: true }),
  closeFeedback: () => set({ isFeedbackOpen: false }),
  // Toggling is always deliberate, so it sets both flags together: opening
  // pins, closing un-pins and hands the column back to hover-peek.
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen, sidebarPinned: !s.sidebarOpen })),
  peekSidebar: (v) => set((s) => (s.sidebarPinned ? {} : { sidebarOpen: v })),
  pinSidebar: () => set({ sidebarOpen: true, sidebarPinned: true }),
  toggleHelperBar: () => set((s) => {
    const opening = !s.helperBarOpen;
    return { helperBarOpen: opening, helperBarPinned: opening, timelineOpen: opening ? false : s.timelineOpen };
  }),
  setSidebarOpen: (v) => set({ sidebarOpen: v, sidebarPinned: v }),
  setHelperBarOpen: (v) => set((s) => ({ helperBarOpen: v, timelineOpen: v ? false : s.timelineOpen })),
  pinHelperBar: () => set({ helperBarOpen: true, helperBarPinned: true, timelineOpen: false }),
  closeHelperBar: () => set({ helperBarOpen: false, helperBarPinned: false }),
  toggleTimeline: () => set((s) => ({ timelineOpen: !s.timelineOpen, helperBarOpen: false, helperBarPinned: false })),
  toggleCommentsPanel: () => set((s) => ({ commentsPanelOpen: !s.commentsPanelOpen })),
  setCommentsPanelOpen: (v) => set({ commentsPanelOpen: v }),
  closeCommentsPanel: () => set({ commentsPanelOpen: false }),
  setTimelineOpen: (v) => set({ timelineOpen: v }),
  setTimelinePreviewVersionId: (id) => set({ timelinePreviewVersionId: id }),
  setActivePiece: (id) => set({
    activePieceId: id,
    timelinePreviewVersionId: null,
    showCreationFlow: false,
  }),
  setActiveIdea: (id) => set({ activeIdeaId: id }),
  setIdeaSpace: (ideaId, space) => set((s) => ({
    ideaSpaces: { ...s.ideaSpaces, [ideaId]: space },
  })),
  toggleIdeaSpace: (ideaId) => set((s) => ({
    ideaSpaces: { ...s.ideaSpaces, [ideaId]: (s.ideaSpaces[ideaId] ?? "write") === "write" ? "pieces" : "write" },
  })),
  setIdeaPanelOpen: (v) => set({ ideaPanelOpen: v }),
  toggleIdeaPanel: () => set((s) => ({ ideaPanelOpen: !s.ideaPanelOpen })),
  revealPiece: (id) => set({ revealPieceId: id }),
  clearRevealPiece: () => set({ revealPieceId: null }),
  setFocusedPiece: (id) => set({ focusedPieceId: id }),
  setHoveredPiece: (id) => set({ hoveredPieceId: id }),
  setShowCreationFlow: (v) => set({ showCreationFlow: v }),
  setGeneratingPiece: (id) => set({ generatingPieceId: id }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  setStreamingError: (error) => set({ streamingError: error }),
  dismissContextPrompt: (pieceId) => set((s) => {
    const next = new Set(s.contextPromptDismissedPieces);
    next.add(pieceId);
    return { contextPromptDismissedPieces: next };
  }),
  setLiveEditorContent: (pieceId, content) => set({
    liveEditorPieceId: pieceId,
    liveEditorContent: content,
  }),
  setDraggingToHelper: (v) => set({ isDraggingToHelper: v }),
  setDraggingToEditor: (v) => set({ isDraggingToEditor: v }),
  setPanelDrag: (v) => set({ panelDrag: v }),
  setPendingSnippetDrop: (v) => set({ pendingSnippetDrop: v }),
  setPendingEditorDeletion: (v) => set({ pendingEditorDeletion: v }),
  commitPendingDrop: () => set({ pendingSnippetDrop: null }),
  cancelPendingDrop: () => set((s) => {
    if (!s.pendingSnippetDrop) return {};
    return { pendingSnippetDrop: { ...s.pendingSnippetDrop, cancelled: true } };
  }),
  setFloatingDragCard: (v) => set({ floatingDragCard: v }),
  setPendingSnippetInsert: (v) => set({ pendingSnippetInsert: v }),
  updateFloatingCardLabel: (label, status) => set((s) => {
    if (!s.floatingDragCard) return {};
    return { floatingDragCard: { ...s.floatingDragCard, label, labelStatus: status } };
  }),
}));
