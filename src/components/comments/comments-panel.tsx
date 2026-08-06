"use client";

import { useMemo, useState } from "react";
import { MessageSquare, PanelBottomClose, Sparkles } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { commentHome, visibleComments } from "@/lib/comment-scope";
import { useToastStore } from "@/hooks/use-toast";

/**
 * The bottom Comments panel: pops up over the editor, independent of the
 * side panels (Snip Bar, Timeline). Shows the commentary units for whichever
 * note or idea is currently the comment's home (see comment-scope.ts) —
 * quick notes-first jottings that can later be "turned into an idea"
 * without leaving the panel.
 */
export function CommentsPanel() {
  const activeNoteId = useAppStore((s) => s.activeNoteId);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const activeIdeaSpace = useAppStore((s) => (s.activeIdeaId ? s.ideaSpaces[s.activeIdeaId] : undefined));
  const closeCommentsPanel = useAppStore((s) => s.closeCommentsPanel);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const comments = useDataStore((s) => s.comments);
  const addComment = useDataStore((s) => s.addComment);
  const promoteCommentToIdea = useDataStore((s) => s.promoteCommentToIdea);
  const showToast = useToastStore((s) => s.showToast);

  const [draft, setDraft] = useState("");

  const home = commentHome(activeNoteId, activeIdeaId, activeIdeaSpace);
  const list = useMemo(() => visibleComments(comments, home), [comments, home]);

  function handleSubmit() {
    if (!home || !draft.trim()) return;
    addComment(home.noteId, home.ideaId, draft.trim());
    setDraft("");
  }

  function handlePromote(id: string) {
    const ideaId = promoteCommentToIdea(id);
    if (!ideaId) {
      showToast("Couldn't turn that into an idea");
      return;
    }
    showToast("Turned into an idea");
  }

  function openIdea(ideaId: string) {
    setActiveIdea(ideaId);
    setIdeaSpace(ideaId, "write");
    closeCommentsPanel();
  }

  return (
    <div className="flex flex-col h-full w-full bg-surface rounded-[var(--radius-xl)] border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <MessageSquare size={14} className="text-text-muted" />
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
            Comments
          </span>
          {list.length > 0 && (
            <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)]">{list.length}</span>
          )}
        </div>
        <button
          onClick={closeCommentsPanel}
          className="p-2 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
        >
          <PanelBottomClose size={16} />
        </button>
      </div>

      {/* Comment list */}
      <div className="flex-1 overflow-y-auto px-6 space-y-2.5">
        {!home ? (
          <p className="py-8 text-center text-[12px] text-text-faint">
            Open a note or idea to leave a comment.
          </p>
        ) : list.length === 0 ? (
          <p className="py-8 text-center text-[12px] text-text-faint">
            No comments yet. Jot one below — turn it into an idea whenever you&apos;re ready.
          </p>
        ) : (
          list.map((comment) => (
            <div
              key={comment.id}
              className="rounded-[var(--radius-lg)] border border-border bg-surface-2 px-4 py-3"
            >
              <p className="text-[13px] text-text-secondary leading-relaxed whitespace-pre-wrap">
                {comment.body}
              </p>
              <div className="mt-2 flex items-center gap-3">
                <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)]">
                  {new Date(comment.createdAt).toLocaleString("en-US", {
                    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                  })}
                </span>
                {comment.promotedIdeaId ? (
                  <button
                    onClick={() => openIdea(comment.promotedIdeaId!)}
                    className="flex items-center gap-1 text-[10px] text-gold hover:opacity-80 transition-opacity duration-150"
                  >
                    <Sparkles size={10} />
                    Ideized — open idea
                  </button>
                ) : (
                  <button
                    onClick={() => handlePromote(comment.id)}
                    className="text-[10px] text-text-muted hover:text-gold transition-colors duration-150"
                  >
                    Turn into an idea
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <div className="px-6 py-4 shrink-0 border-t border-border">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={home ? "Add a comment..." : "Open a note or idea first"}
          disabled={!home}
          rows={2}
          className="w-full bg-surface-2 border border-border-strong rounded-[var(--radius-lg)] px-3 py-2
            text-[13px] text-text-primary placeholder:text-text-faint outline-none resize-none disabled:opacity-50"
        />
        <div className="mt-2 flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={!home || !draft.trim()}
            className="px-4 py-2 rounded-[var(--radius-default)] text-[12px] font-medium
              bg-surface-2 text-text-secondary border border-border-strong
              hover:bg-surface-3 hover:text-text-primary hover:border-gold/20 transition-all duration-150
              disabled:opacity-40 disabled:pointer-events-none"
          >
            Add comment
          </button>
        </div>
      </div>
    </div>
  );
}
