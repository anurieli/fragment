import type { ContentPiece, Idea } from "@/lib/content-engine";
import type { Note } from "@/lib/types";

export type EmptyCreationKind = "note" | "idea" | "piece";

const pendingEmptyCreations: Record<EmptyCreationKind, Set<string>> = {
  note: new Set(),
  idea: new Set(),
  piece: new Set(),
};

export function trackEmptyCreation(kind: EmptyCreationKind, id: string): void {
  if (id) pendingEmptyCreations[kind].add(id);
}

export function consumeEmptyCreation(kind: EmptyCreationKind, id: string): boolean {
  return pendingEmptyCreations[kind].delete(id);
}

export function resetEmptyCreations(): void {
  pendingEmptyCreations.note.clear();
  pendingEmptyCreations.idea.clear();
  pendingEmptyCreations.piece.clear();
}

function blank(value: string | undefined): boolean {
  return !value?.trim();
}

export function isEmptyNote(note: Note): boolean {
  return (
    blank(note.title) &&
    blank(note.subtitle) &&
    blank(note.content) &&
    blank(note.goal) &&
    blank(note.audience) &&
    blank(note.tone) &&
    blank(note.remember) &&
    note.voiceId === undefined
  );
}

interface IdeaUsage {
  hasChildren: boolean;
  hasPieces: boolean;
  hasResources: boolean;
}

export function isEmptyIdea(idea: Idea, usage: IdeaUsage): boolean {
  const defaultTitle = blank(idea.title) || idea.title.trim() === "Untitled idea";
  return (
    idea.origin === "user" &&
    defaultTitle &&
    blank(idea.summary) &&
    idea.priority === 0 &&
    idea.pinnedAt === undefined &&
    idea.voiceId === undefined &&
    !usage.hasChildren &&
    !usage.hasPieces &&
    !usage.hasResources
  );
}

interface PieceUsage {
  hasResources: boolean;
}

export function isEmptyPiece(piece: ContentPiece, usage: PieceUsage): boolean {
  return (
    piece.origin === "user" &&
    piece.noteId === undefined &&
    piece.format === "other" &&
    piece.status === "inbox" &&
    blank(piece.title) &&
    blank(piece.body) &&
    piece.priority === 0 &&
    piece.scheduledAt === undefined &&
    piece.publish === undefined &&
    piece.publishAttemptedAt === undefined &&
    piece.agentMeta === undefined &&
    !usage.hasResources
  );
}
