import type { ContentPiece, Idea } from "@/lib/content-engine";

export type EmptyCreationKind = "idea" | "piece";

const pendingEmptyCreations: Record<EmptyCreationKind, Set<string>> = {
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
  pendingEmptyCreations.idea.clear();
  pendingEmptyCreations.piece.clear();
}

function blank(value: string | undefined): boolean {
  return !value?.trim();
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
    blank(idea.goal) &&
    blank(idea.audience) &&
    blank(idea.tone) &&
    blank(idea.remember) &&
    idea.priority === 0 &&
    idea.pinnedAt === undefined &&
    idea.voiceId === undefined &&
    idea.archivedAt === undefined &&
    idea.deletedAt === undefined &&
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
    piece.status === "in-progress" &&
    piece.reviewQueue === undefined &&
    blank(piece.title) &&
    blank(piece.body) &&
    blank(piece.subtitle) &&
    blank(piece.goal) &&
    blank(piece.audience) &&
    blank(piece.tone) &&
    blank(piece.remember) &&
    piece.voiceId === undefined &&
    piece.legacyNoteId === undefined &&
    piece.priority === 0 &&
    piece.pinnedAt === undefined &&
    piece.scheduledAt === undefined &&
    piece.publish === undefined &&
    piece.publishAttemptedAt === undefined &&
    piece.editedAfterPublishAt === undefined &&
    piece.agentMeta === undefined &&
    piece.archivedAt === undefined &&
    piece.deletedAt === undefined &&
    !usage.hasResources
  );
}
