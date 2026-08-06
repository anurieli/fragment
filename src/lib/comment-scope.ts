import type { Comment } from "./types";
import type { IdeaSpace } from "@/stores/app-store";

/**
 * Which single surface a new comment belongs to.
 *
 * Unlike a Snippet, a Comment carries exactly one home for its whole life
 * (see the Comment type in types.ts), so this picks one rather than
 * computing an overlap. `activeNoteId` alone means a standalone draft.
 * Inside an idea, the idea's own Write/Pieces choice decides: Pieces has no
 * note on screen, so the comment goes to the idea; Write attaches it to
 * whichever draft is open (falling back to the idea itself if it has none
 * yet). Returns null when nothing is open to comment on.
 */
export function commentHome(
  activeNoteId: string | null,
  activeIdeaId: string | null,
  ideaSpace: IdeaSpace | undefined,
): { noteId: string | null; ideaId: string | null } | null {
  if (activeIdeaId && ideaSpace === "pieces") return { noteId: null, ideaId: activeIdeaId };
  if (activeNoteId) return { noteId: activeNoteId, ideaId: null };
  if (activeIdeaId) return { noteId: null, ideaId: activeIdeaId };
  return null;
}

/** The comments belonging to the current home, oldest first. */
export function visibleComments(
  comments: Record<string, Comment> | readonly Comment[],
  home: { noteId: string | null; ideaId: string | null } | null,
): Comment[] {
  if (!home) return [];
  const all = Array.isArray(comments) ? comments : Object.values(comments);
  return (all as Comment[])
    .filter((c) => c.noteId === home.noteId && c.ideaId === home.ideaId)
    .sort((a, b) => a.createdAt - b.createdAt);
}
