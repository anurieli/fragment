"use client";

import { useEffect, useRef } from "react";
import {
  consumeEmptyCreation,
  isEmptyIdea,
  isEmptyNote,
  isEmptyPiece,
} from "@/lib/empty-creations";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";

export function discardPendingEmptyNote(id: string): boolean {
  if (!consumeEmptyCreation("note", id)) return false;
  const note = useDataStore.getState().notes[id];
  if (!note || !isEmptyNote(note)) return false;
  const appState = useAppStore.getState();
  if (appState.liveEditorNoteId === id && appState.liveEditorContent?.trim()) {
    useDataStore.getState().updateNoteContent(id, appState.liveEditorContent);
    return false;
  }
  useDataStore.getState().deleteNote(id);
  return true;
}

export function discardPendingEmptyIdea(id: string): boolean {
  if (!consumeEmptyCreation("idea", id)) return false;
  const state = useContentStore.getState();
  const idea = state.ideas[id];
  if (!idea || idea.deletedAt !== undefined) return false;
  const usage = {
    hasChildren: Object.values(state.ideas).some(
      (candidate) => candidate.parentId === id && candidate.deletedAt === undefined,
    ),
    hasPieces: Object.values(state.pieces).some(
      (piece) => piece.ideaId === id && piece.deletedAt === undefined,
    ),
    hasResources: Object.values(state.resources).some(
      (resource) => resource.ownerType === "idea" && resource.ownerId === id,
    ),
  };
  if (!isEmptyIdea(idea, usage)) return false;
  state.deleteIdeaCascade(id);
  return true;
}

export function discardPendingEmptyPiece(id: string): boolean {
  if (!consumeEmptyCreation("piece", id)) return false;
  const state = useContentStore.getState();
  const piece = state.pieces[id];
  if (!piece || piece.deletedAt !== undefined) return false;
  const hasResources = Object.values(state.resources).some(
    (resource) => resource.ownerType === "piece" && resource.ownerId === id,
  );
  if (!isEmptyPiece(piece, { hasResources })) return false;
  state.rejectPiece(id);
  return true;
}

/**
 * Removes only blank entities created in this browser session, at the moment
 * navigation leaves them. Existing blank records are never swept merely
 * because the user opened and closed them.
 */
export function useEmptyCreationCleanup(): void {
  const activeNoteId = useAppStore((state) => state.activeNoteId);
  const activeIdeaId = useAppStore((state) => state.activeIdeaId);
  const focusedPieceId = useAppStore((state) => state.focusedPieceId);
  const previousNoteId = useRef<string | null>(null);
  const previousIdeaId = useRef<string | null>(null);
  const previousPieceId = useRef<string | null>(null);

  useEffect(() => {
    const previous = previousNoteId.current;
    previousNoteId.current = activeNoteId;
    if (previous && previous !== activeNoteId) discardPendingEmptyNote(previous);
  }, [activeNoteId]);

  useEffect(() => {
    const previous = previousPieceId.current;
    previousPieceId.current = focusedPieceId;
    if (previous && previous !== focusedPieceId) discardPendingEmptyPiece(previous);
  }, [focusedPieceId]);

  useEffect(() => {
    const previous = previousIdeaId.current;
    previousIdeaId.current = activeIdeaId;
    if (previous && previous !== activeIdeaId) discardPendingEmptyIdea(previous);
  }, [activeIdeaId]);

  useEffect(() => {
    const discardCurrentCreations = () => {
      const state = useAppStore.getState();
      if (state.activeNoteId) discardPendingEmptyNote(state.activeNoteId);
      if (state.focusedPieceId) discardPendingEmptyPiece(state.focusedPieceId);
      if (state.activeIdeaId) discardPendingEmptyIdea(state.activeIdeaId);
    };
    window.addEventListener("pagehide", discardCurrentCreations);
    return () => window.removeEventListener("pagehide", discardCurrentCreations);
  }, []);
}
