"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Flag, MoreHorizontal, ChevronDown } from "lucide-react";
import type { ContentFormat, ContentPiece, Priority } from "@/lib/content-engine";
import type { PublishPlatform } from "@/lib/publish";
import { PLATFORM_CHAR_LIMITS, TWEET_CHAR_LIMIT, charCount, countTweetThread, publishPendingState } from "@/lib/publish";
import { useContentStore } from "@/stores/content-store";
import { formatDate } from "@/lib/utils";
import { ageLabel, stalenessLevel } from "./feed-logic";
import { PieceShareMenu } from "./piece-share-menu";

const FORMAT_LABELS: Record<ContentFormat, string> = {
  tweet: "X",
  linkedin: "LinkedIn",
  substack: "Substack",
  essay: "Essay",
  script: "Script",
  other: "Other",
};

const FORMAT_TO_PLATFORM: Partial<Record<ContentFormat, PublishPlatform>> = {
  tweet: "tweet",
  linkedin: "linkedin",
  substack: "substack",
};

const STATUS_LABELS: Record<ContentPiece["status"], string> = {
  inbox: "in inbox",
  "in-progress": "in progress",
  ready: "ready",
  published: "published",
};

const STATUS_META: Record<ContentPiece["status"], { label: string; dotClass: string }> = {
  inbox: { label: "Inbox", dotClass: "bg-text-faint" },
  "in-progress": { label: "In progress", dotClass: "bg-blue" },
  ready: { label: "Ready", dotClass: "bg-gold" },
  published: { label: "Published", dotClass: "bg-green" },
};

const PRIORITY_META: Record<1 | 2 | 3 | 4, { label: string; className: string }> = {
  1: { label: "Urgent", className: "text-red" },
  2: { label: "High", className: "text-gold" },
  3: { label: "Medium", className: "text-blue" },
  4: { label: "Low", className: "text-text-muted" },
};

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: 1, label: "Urgent" },
  { value: 2, label: "High" },
  { value: 3, label: "Medium" },
  { value: 4, label: "Low" },
  { value: 0, label: "No priority" },
];

function platformChip(format: ContentFormat): string {
  if (format === "tweet") return `X · ${TWEET_CHAR_LIMIT}`;
  return FORMAT_LABELS[format].toUpperCase();
}

function charFooter(piece: ContentPiece): { text: string; over: boolean } {
  const body = piece.body ?? "";
  if (piece.format === "tweet") {
    const segments = countTweetThread(body);
    if (segments.length > 1) {
      const overCount = segments.filter((s) => s.over).length;
      return {
        text: `${segments.length} tweets${overCount ? ` · ${overCount} over` : ""}`,
        over: overCount > 0,
      };
    }
    const count = segments[0]?.count ?? charCount(body);
    return { text: `${count}/${TWEET_CHAR_LIMIT}`, over: count > TWEET_CHAR_LIMIT };
  }
  const platform = FORMAT_TO_PLATFORM[piece.format];
  const limit = platform ? PLATFORM_CHAR_LIMITS[platform] : null;
  const count = charCount(body);
  if (limit == null) return { text: `${count} chars`, over: false };
  return { text: `${count}/${limit}`, over: count > limit };
}

interface PieceCardProps {
  piece: ContentPiece;
  now: number;
  focused: boolean;
  editing: boolean;
  onFocusCard: () => void;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  onDelete: () => void;
}

/**
 * A single short-form piece: meta row, an auto-growing plain textarea (not
 * Tiptap — byte-exact whitespace is the promise for short-form content),
 * then a footer with live char count and placeholder Share/overflow menu.
 * Borderless — separation between cards comes from PieceSeparator hairlines,
 * not a card border. The focused card (roving keyboard focus) gets a 3px
 * gold left rail.
 */
export function PieceCard({
  piece,
  now,
  focused,
  editing,
  onFocusCard,
  onEnterEdit,
  onExitEdit,
  onDelete,
}: PieceCardProps) {
  const updatePiece = useContentStore((s) => s.updatePiece);
  const markPieceSeen = useContentStore((s) => s.markPieceSeen);
  const cyclePiecePriority = useContentStore((s) => s.cyclePiecePriority);
  const setPiecePriority = useContentStore((s) => s.setPiecePriority);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [piece.body, resize]);

  useEffect(() => {
    // Only drive focus programmatically (and jump the cursor to the end)
    // when edit mode was entered some other way (e.g. the "Enter" key) — if
    // the textarea is already the active element, the user clicked directly
    // into it, and moving the caret would clobber their click position.
    if (focused && editing && document.activeElement !== textareaRef.current) {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }
  }, [focused, editing]);

  const handleTextareaFocus = useCallback(() => {
    if (!piece.seen) markPieceSeen(piece.id);
    onEnterEdit();
  }, [piece.seen, piece.id, markPieceSeen, onEnterEdit]);

  const handleBodyChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updatePiece(piece.id, { body: e.target.value });
    },
    [piece.id, updatePiece],
  );

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        textareaRef.current?.blur();
        onExitEdit();
      }
    },
    [onExitEdit],
  );

  const footer = charFooter(piece);
  const stale = stalenessLevel(piece, now);
  const staleClass =
    piece.status === "published"
      ? "text-text-faint"
      : stale === "idle"
        ? "text-gold font-medium"
        : stale === "stale"
          ? "text-gold/70"
          : "text-text-faint";

  return (
    <div
      data-piece-card
      data-piece-id={piece.id}
      onClick={onFocusCard}
      className={`relative pl-5 pr-2 py-4 transition-colors duration-150 rounded-[var(--radius-default)] ${
        focused ? "bg-surface-2/40" : ""
      }`}
    >
      {focused && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-gold" />
      )}

      {/* Meta row */}
      <div className="flex items-center gap-2.5 mb-2 flex-wrap">
        <span className="text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-muted px-1.5 py-0.5 rounded-[4px] bg-surface-2 border border-border">
          {platformChip(piece.format)}
        </span>

        <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[piece.status].dotClass}`} />
          {STATUS_META[piece.status].label}
        </span>

        {/* Substack verified-publish loop: "awaiting confirmation" / "did
            this go live?" badge — see publishPendingState. */}
        {(() => {
          const pending = publishPendingState(piece.publishAttemptedAt, now);
          if (pending === "none") return null;
          return (
            <span
              title={
                pending === "nudge"
                  ? "Attempted over 24h ago — did this go live on Substack?"
                  : "Copied — waiting for Fragment to confirm this went live on Substack"
              }
              className={`text-[10px] px-1.5 py-0.5 rounded-[4px] border ${
                pending === "nudge"
                  ? "text-gold border-gold/40 bg-gold/10"
                  : "text-text-faint border-border bg-surface-2"
              }`}
            >
              {pending === "nudge" ? "did this go live?" : "awaiting confirmation"}
            </span>
          );
        })()}

        {piece.priority !== 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              cyclePiecePriority(piece.id);
            }}
            title={`Priority: ${PRIORITY_META[piece.priority as 1 | 2 | 3 | 4].label} — click to cycle`}
            className={`flex items-center gap-1 text-[11px] ${PRIORITY_META[piece.priority as 1 | 2 | 3 | 4].className}`}
          >
            <Flag size={10} fill="currentColor" />
          </button>
        )}

        <span className="text-[10px] font-[family-name:var(--font-mono)] text-text-faint">
          {piece.id.slice(0, 6)}
        </span>

        {piece.agentMeta && (
          <span className="text-[11px] text-text-faint">
            from {piece.agentMeta.agent} · {formatDate(piece.agentMeta.pushedAt)}
          </span>
        )}

        <span className={`ml-auto flex items-center gap-1.5 text-[11px] ${staleClass}`}>
          {!piece.seen && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-gold"
              style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
            />
          )}
          {STATUS_LABELS[piece.status]} {ageLabel(piece, now)}
        </span>
      </div>

      {/* Body — plain, auto-growing textarea. Not Tiptap: short-form content is
          byte-exact, no markdown rendering. */}
      <textarea
        ref={textareaRef}
        data-piece-textarea
        tabIndex={-1}
        value={piece.body ?? ""}
        onChange={handleBodyChange}
        onFocus={handleTextareaFocus}
        onBlur={onExitEdit}
        onKeyDown={handleTextareaKeyDown}
        placeholder="Write the piece..."
        className="shortform-piece-textarea w-full resize-none bg-transparent outline-none text-[14px] leading-relaxed text-text-primary placeholder:text-text-faint font-[family-name:var(--font-body)]"
        rows={1}
      />

      {/* Footer */}
      <div className="flex items-center gap-3 mt-2.5">
        <span className={`text-[10px] font-[family-name:var(--font-mono)] ${footer.over ? "text-red" : "text-text-faint"}`}>
          {footer.text}
        </span>

        <div className="ml-auto flex items-center gap-1.5">
          <PieceShareMenu piece={piece} />

          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
                setPriorityMenuOpen(false);
              }}
              className="p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
            >
              <MoreHorizontal size={14} />
            </button>

            {menuOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-20 w-40 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl py-1"
                onMouseLeave={() => { setMenuOpen(false); setPriorityMenuOpen(false); }}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); setPriorityMenuOpen((v) => !v); }}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
                >
                  Set priority
                  <ChevronDown size={10} />
                </button>
                {priorityMenuOpen && (
                  <div className="border-t border-border py-1">
                    {PRIORITY_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPiecePriority(piece.id, opt.value);
                          setMenuOpen(false);
                          setPriorityMenuOpen(false);
                        }}
                        className="block w-full text-left px-4 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="border-t border-border mt-1 pt-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="block w-full text-left px-3 py-1.5 text-[12px] text-red hover:bg-red-muted transition-colors duration-150"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
