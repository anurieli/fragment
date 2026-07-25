"use client";

import { useEffect, useMemo } from "react";
import { X, MessageSquare, User } from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { ReviewComment } from "@/lib/types";
import { useReviewStore } from "@/stores/review-store";
import { useToastStore } from "@/hooks/use-toast";
import { locateAnchor } from "@/lib/review";
import { formatDate } from "@/lib/utils";

interface ReviewPanelProps {
  noteId: string;
  editor: Editor;
  onClose: () => void;
}

/**
 * Flattens the live editor doc into plain text alongside a parallel array
 * mapping each character index back to its ProseMirror position, so a
 * comment's `anchorText` (captured from the reviewer's copy of the document)
 * can be located in the *current* document and turned into a selection.
 * Best-effort: if the note has since changed, the anchor may no longer
 * match and the caller degrades gracefully.
 */
function buildTextIndex(doc: Editor["state"]["doc"]): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) map.push(pos + i);
      text += node.text;
    } else if (node.isBlock && text.length > 0 && text[text.length - 1] !== "\n") {
      text += "\n";
      map.push(pos);
    }
  });
  return { text, map };
}

export function ReviewPanel({ noteId, editor, onClose }: ReviewPanelProps) {
  const loadForNote = useReviewStore((s) => s.loadForNote);
  const reviews = useReviewStore((s) => s.listForNote(noteId));
  const showToast = useToastStore((s) => s.showToast);

  useEffect(() => {
    loadForNote(noteId);
  }, [noteId, loadForNote]);

  const totalComments = useMemo(
    () => reviews.reduce((sum, r) => sum + r.comments.length, 0),
    [reviews]
  );

  function handleCommentClick(comment: ReviewComment) {
    if (!comment.anchorText) {
      showToast("General comment — not tied to specific text");
      return;
    }
    const { text, map } = buildTextIndex(editor.state.doc);
    const pos = locateAnchor(text, comment.anchorText, comment.prefix, comment.suffix);
    if (!pos || map.length === 0) {
      showToast("Couldn't find that text — the document may have changed since the review");
      return;
    }
    const from = map[Math.min(pos.start, map.length - 1)];
    const to = map[Math.min(pos.end - 1, map.length - 1)] + 1;
    editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col h-full w-[380px] bg-surface border-l border-border-strong shadow-2xl overflow-hidden"
        style={{ animation: "slideIn 0.15s ease-out" }}
      >
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <MessageSquare size={14} className="text-text-muted" />
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
              Reviews
            </span>
            <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)]">
              {totalComments}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
          >
            <X size={16} />
          </button>
        </div>

        <p className="px-6 pb-4 text-[12px] text-text-muted shrink-0">
          Feedback imported from reviewers. Click a highlighted comment to jump to it in the document.
        </p>

        <div className="flex-1 overflow-y-auto px-5 pb-6 space-y-5">
          {reviews.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <MessageSquare size={24} className="mx-auto mb-3 text-text-faint opacity-40" />
              <p className="text-[13px] text-text-muted">No reviews yet</p>
              <p className="text-[12px] text-text-faint mt-2">
                Use Share &rarr; Send for review to get feedback, then import the returned file here.
              </p>
            </div>
          ) : (
            reviews.map((review) => (
              <div key={review.id} className="rounded-[var(--radius-lg)] bg-surface-2 border border-border-strong overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                  <User size={12} className="text-gold shrink-0" />
                  <span className="text-[12px] font-medium text-text-primary truncate">
                    {review.reviewerName || "Anonymous reviewer"}
                  </span>
                  <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] ml-auto shrink-0">
                    {formatDate(review.receivedAt)}
                  </span>
                </div>
                <div className="p-2 space-y-1.5">
                  {review.comments.length === 0 ? (
                    <p className="px-2 py-2 text-[12px] text-text-faint italic">No comments in this review</p>
                  ) : (
                    review.comments.map((comment) => (
                      <button
                        key={comment.id}
                        onClick={() => handleCommentClick(comment)}
                        className="w-full text-left px-3 py-2.5 rounded-[var(--radius-sm)] hover:bg-surface-3 transition-colors duration-150"
                      >
                        {comment.anchorText ? (
                          <p className="text-[11px] text-gold font-[family-name:var(--font-mono)] mb-1 truncate">
                            &ldquo;{comment.anchorText.slice(0, 60)}
                            {comment.anchorText.length > 60 ? "…" : ""}&rdquo;
                          </p>
                        ) : (
                          <p className="text-[10px] uppercase tracking-wide text-text-faint mb-1">General comment</p>
                        )}
                        <p className="text-[13px] text-text-secondary line-clamp-3">{comment.body}</p>
                      </button>
                    ))
                  )}
                  {review.editedFullText && (
                    <p className="px-3 py-2 text-[11px] text-text-faint italic">
                      This reviewer also submitted direct text edits (not shown here — compare manually).
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
