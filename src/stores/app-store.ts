"use client";

import { create } from "zustand";
import type { Snippet, AIProvider } from "@/lib/types";

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

interface PendingEditorDeletion {
  from: number;
  to: number;
  snippetId?: string;
}

/** Set by snippet card custom drag; editor watches and processes insertion. */
interface PendingSnippetInsert {
  snippetId: string;
  content: string;
  /** Pointer coordinates for drag/drop. Omitted by the context-menu action,
   * which inserts at the editor's current selection. */
  clientX?: number;
  clientY?: number;
}

/** Which writing space a note-editor toolbar shows for the active idea. */
export type IdeaSpace = "write" | "pieces";

interface AppState {
  sidebarOpen: boolean;
  helperBarOpen: boolean;
  helperBarPinned: boolean;
  timelineOpen: boolean;
  timelinePreviewVersionId: string | null;
  activeNoteId: string | null;
  /** The idea selected in the sidebar, if any. Independent of activeNoteId — an idea's Write space shows whichever note is linked to it (see sidebar.tsx). */
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
  liveEditorNoteId: string | null;
  liveEditorContent: string | null;
  isDraggingToHelper: boolean;
  isDraggingToEditor: boolean;
  pendingSnippetDrop: PendingSnippetDrop | null;
  pendingEditorDeletion: PendingEditorDeletion | null;
  floatingDragCard: FloatingDragCard | null;
  showCreationFlow: boolean;
  generatingNoteId: string | null;
  streamingContent: string | null;
  streamingError: string | null;
  isFeedbackOpen: boolean;
  contextPromptDismissedNotes: Set<string>;
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
  toggleHelperBar: () => void;
  toggleTimeline: () => void;
  setSidebarOpen: (v: boolean) => void;
  setHelperBarOpen: (v: boolean) => void;
  pinHelperBar: () => void;
  closeHelperBar: () => void;
  setTimelineOpen: (v: boolean) => void;
  setTimelinePreviewVersionId: (id: string | null) => void;
  setActiveNote: (id: string | null) => void;
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
  setGeneratingNote: (id: string | null) => void;
  setStreamingContent: (content: string | null) => void;
  setStreamingError: (error: string | null) => void;
  dismissContextPrompt: (noteId: string) => void;
  setLiveEditorContent: (noteId: string, content: string) => void;
  setDraggingToHelper: (v: boolean) => void;
  setDraggingToEditor: (v: boolean) => void;
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
  helperBarOpen: false,
  helperBarPinned: false,
  timelineOpen: false,
  timelinePreviewVersionId: null,
  activeNoteId: null,
  activeIdeaId: null,
  ideaSpaces: {},
  ideaPanelOpen: true,
  revealPieceId: null,
  focusedPieceId: null,
  hoveredPieceId: null,
  liveEditorNoteId: null,
  liveEditorContent: null,
  isDraggingToHelper: false,
  isDraggingToEditor: false,
  pendingSnippetDrop: null,
  pendingEditorDeletion: null,
  floatingDragCard: null,
  pendingSnippetInsert: null,
  showCreationFlow: false,
  generatingNoteId: null,
  streamingContent: null,
  streamingError: null,
  isFeedbackOpen: false,
  contextPromptDismissedNotes: new Set(),
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
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleHelperBar: () => set((s) => {
    const opening = !s.helperBarOpen;
    return { helperBarOpen: opening, helperBarPinned: opening, timelineOpen: opening ? false : s.timelineOpen };
  }),
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  setHelperBarOpen: (v) => set((s) => ({ helperBarOpen: v, timelineOpen: v ? false : s.timelineOpen })),
  pinHelperBar: () => set({ helperBarOpen: true, helperBarPinned: true, timelineOpen: false }),
  closeHelperBar: () => set({ helperBarOpen: false, helperBarPinned: false }),
  toggleTimeline: () => set((s) => ({ timelineOpen: !s.timelineOpen, helperBarOpen: false, helperBarPinned: false })),
  setTimelineOpen: (v) => set({ timelineOpen: v }),
  setTimelinePreviewVersionId: (id) => set({ timelinePreviewVersionId: id }),
  setActiveNote: (id) => set({
    activeNoteId: id,
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
  setGeneratingNote: (id) => set({ generatingNoteId: id }),
  setStreamingContent: (content) => set({ streamingContent: content }),
  setStreamingError: (error) => set({ streamingError: error }),
  dismissContextPrompt: (noteId) => set((s) => {
    const next = new Set(s.contextPromptDismissedNotes);
    next.add(noteId);
    return { contextPromptDismissedNotes: next };
  }),
  setLiveEditorContent: (noteId, content) => set({
    liveEditorNoteId: noteId,
    liveEditorContent: content,
  }),
  setDraggingToHelper: (v) => set({ isDraggingToHelper: v }),
  setDraggingToEditor: (v) => set({ isDraggingToEditor: v }),
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
