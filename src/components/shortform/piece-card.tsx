"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { Flag, MoreHorizontal, ChevronDown } from "lucide-react";
import type { ContentFormat, ContentPiece, Priority } from "@/lib/content-engine";
import { PLATFORM_CHAR_LIMITS, TWEET_CHAR_LIMIT, charCount, countTweetThread, markdownToPreviewHtml, publishPendingState } from "@/lib/publish";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useToastStore } from "@/hooks/use-toast";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { useSlashCommand } from "@/hooks/use-slash-command";
import { useLabelSnippet } from "@/hooks/use-label-snippet";
import {
  buildRefineContext,
  buildFlowContext,
  findLinkedNoteContent,
  resolveSnipTargetNoteId,
  FORMAT_TO_PLATFORM,
} from "@/lib/piece-ai";
import { formatDate } from "@/lib/utils";
import { ageLabel, scheduleLabel, scheduleOverdue, stalenessLevel } from "./feed-logic";
import { PieceResourcesPopover } from "./piece-resources-popover";
import { PieceShareMenu } from "./piece-share-menu";
import { PieceRefineMenu } from "./piece-refine-menu";
import { PieceTriageBar } from "./piece-triage";
import { LiveMarkdownTextarea } from "./live-markdown-textarea";

const FORMAT_LABELS: Record<ContentFormat, string> = {
  tweet: "X",
  linkedin: "LinkedIn",
  substack: "Substack",
  essay: "Essay",
  script: "Script",
  other: "Other",
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
  /** 1-based position in the visible feed, for the "3 / 12" locator. */
  position: number;
  total: number;
  onFocusCard: () => void;
  onEnterEdit: () => void;
  onExitEdit: () => void;
  onDelete: () => void;
}

/**
 * One short-form piece, filling the feed's viewport as a single page: a meta
 * row pinned to the top, the piece's text scrolling in the middle, and the
 * triage row + footer pinned to the bottom. Reading one piece shouldn't mean
 * watching the next one slide into frame, so the feed snaps a page at a time
 * (see shortform-feed.tsx) and only the middle band moves under you.
 *
 * The text is a plain textarea, never Tiptap — byte-exact whitespace is the
 * promise for short-form content — with live markdown highlighting painted
 * behind it while editing (LiveMarkdownTextarea) and fully rendered markdown
 * while reading. The focused page gets a 3px gold left rail.
 */
export function PieceCard({
  piece,
  now,
  focused,
  editing,
  position,
  total,
  onFocusCard,
  onEnterEdit,
  onExitEdit,
  onDelete,
}: PieceCardProps) {
  const updatePiece = useContentStore((s) => s.updatePiece);
  const markPieceSeen = useContentStore((s) => s.markPieceSeen);
  const cyclePiecePriority = useContentStore((s) => s.cyclePiecePriority);
  const setPiecePriority = useContentStore((s) => s.setPiecePriority);
  const ideas = useContentStore((s) => s.ideas);
  const allPieces = useContentStore((s) => s.pieces);
  const notes = useDataStore((s) => s.notes);
  const addSnippet = useDataStore((s) => s.addSnippet);
  const activeNoteId = useAppStore((s) => s.activeNoteId);
  const setHoveredPiece = useAppStore((s) => s.setHoveredPiece);
  const showToast = useToastStore((s) => s.showToast);
  const { edit: inlineEdit, enabled: inlineEditEnabled } = useInlineEdit();
  const { generateStream, abort: abortFlow, enabled: slashEnabled } = useSlashCommand();
  const { labelSnippet } = useLabelSnippet();
  const idea = ideas[piece.ideaId];

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const overflowAnchorRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  // The footer this hangs off is pinned to the bottom of the page.
  const menuPlacement = useMenuPlacement(menuOpen, overflowAnchorRef, overflowMenuRef);
  const [priorityMenuOpen, setPriorityMenuOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  // Flow (⌘⏎ / "Draft with Flow"): streamedBody mirrors the long-form
  // editor's streamingContent pattern (editor.tsx) — chunks accumulate in
  // local state and only commit to the store (updatePiece) once generation
  // finishes, so IndexedDB isn't written on every animation frame.
  const [flowGenerating, setFlowGenerating] = useState(false);
  const [streamedBody, setStreamedBody] = useState<string | null>(null);

  // The one string this card is about, from whichever source is live.
  const body = flowGenerating ? streamedBody ?? "" : piece.body ?? "";
  // Flow streams into the textarea, so a generating card counts as editing
  // even if the user never clicked in.
  const isEditing = editing || flowGenerating;

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [piece.body, streamedBody, isEditing, resize]);

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

  const enterEditing = useCallback(() => {
    if (!piece.seen) markPieceSeen(piece.id);
    onEnterEdit();
  }, [piece.seen, piece.id, markPieceSeen, onEnterEdit]);

  // Focus is reading, not just a prelude to editing: now that a card shows
  // its formatted text, landing on one (click, J/K, or a jump from the idea
  // panel) is enough to clear its unseen dot.
  useEffect(() => {
    if (focused && !piece.seen) markPieceSeen(piece.id);
  }, [focused, piece.seen, piece.id, markPieceSeen]);

  const handleBodyChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updatePiece(piece.id, { body: e.target.value });
    },
    [piece.id, updatePiece],
  );

  // Flow: draft this piece from scratch via the existing generation path
  // (use-slash-command's generateStream — same provider/model plumbing the
  // long-form editor's "/" trigger uses, just with a piece-shaped context;
  // see buildFlowContext in piece-ai.ts). Triggered by ⌘⏎ in the textarea or
  // the ⋯ menu's "Draft with Flow" item.
  const handleFlowGenerate = useCallback(() => {
    if (flowGenerating) return;
    // Silence was the worst answer here: ⌘⏎ with Flow switched off did
    // nothing at all, which reads as a broken feature rather than an off one.
    if (!slashEnabled) {
      showToast("Flow is off — turn on slash commands in Settings → AI.");
      return;
    }
    const linkedNoteContent = findLinkedNoteContent(piece.ideaId, Object.values(allPieces), notes);
    const ctx = buildFlowContext({ format: piece.format, idea, linkedNoteContent });
    const baseBody = piece.body ?? "";

    setFlowGenerating(true);
    setStreamedBody(baseBody);

    generateStream(
      ctx.contextAbove,
      "",
      ctx.goal,
      "",
      "",
      ctx.remember,
      ctx.instruction,
      {
        onChunk: (accumulated) => {
          setStreamedBody(baseBody ? `${baseBody}\n\n${accumulated}` : accumulated);
        },
        onDone: (final) => {
          const finalBody = baseBody ? `${baseBody}\n\n${final}` : final;
          updatePiece(piece.id, { body: finalBody });
        },
        onError: () => {},
      },
      piece.id,
      idea?.voiceId,
    )
      // Clearing here, not in onDone/onError: generateStream resolves on every
      // path, including its two abort returns, which call NO callback at all
      // (see use-slash-command.ts). Leaving `flowGenerating` true is not a
      // cosmetic bug — it holds the textarea readOnly, so a cancelled or
      // stalled generation locked the piece until a page reload.
      .finally(() => {
        setStreamedBody(null);
        setFlowGenerating(false);
      });
  }, [
    slashEnabled,
    flowGenerating,
    piece,
    allPieces,
    notes,
    idea,
    generateStream,
    updatePiece,
    showToast,
  ]);

  /** Stop mid-generation and keep what already streamed — the same bargain the
   * long-form editor's Stop makes. Without this the only exit from a stalled
   * generation was reloading the page. */
  const handleFlowStop = useCallback(() => {
    const partial = streamedBody;
    abortFlow();
    if (partial !== null && partial !== (piece.body ?? "")) {
      updatePiece(piece.id, { body: partial });
    }
    setStreamedBody(null);
    setFlowGenerating(false);
    showToast("Stopped — kept what was written.");
  }, [streamedBody, abortFlow, piece.id, piece.body, updatePiece, showToast]);

  // A card that goes away mid-stream (filter change, delete, switching ideas)
  // shouldn't leave a request running against a piece nobody is looking at.
  useEffect(() => () => abortFlow(), [abortFlow]);

  const handleTextareaKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Escape") {
        e.preventDefault();
        textareaRef.current?.blur();
        onExitEdit();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleFlowGenerate();
      }
    },
    [onExitEdit, handleFlowGenerate],
  );

  // Refine: context-aware edit of the current textarea selection, routed
  // through the existing useInlineEdit flow. See buildRefineContext in
  // piece-ai.ts for how before/after context, the idea's title/summary, the
  // voice chain (idea.voiceId -> default — a piece has no voiceId of its
  // own), and the platform/char-limit hint are assembled.
  const handleRefineEdit = useCallback(
    async (instruction: string, selectionStart: number, selectionEnd: number): Promise<string | null> => {
      if (!inlineEditEnabled) return null;
      const body = piece.body ?? "";
      const selectedText = body.slice(selectionStart, selectionEnd);
      if (!selectedText.trim()) return null;
      const ctx = buildRefineContext({
        format: piece.format,
        body,
        selectionStart,
        selectionEnd,
        idea,
      });
      return inlineEdit(
        selectedText,
        ctx.contextBefore,
        ctx.contextAfter,
        ctx.goal,
        "",
        "",
        ctx.remember,
        instruction,
        piece.id,
        ctx.voiceId,
      );
    },
    [inlineEditEnabled, piece, idea, inlineEdit],
  );

  // Snip out: lifts the selection into the Snip Bar via the existing
  // addSnippet + labelSnippet path, tagged with this piece's ideaId. A piece
  // has no note of its own (short-form body is inline), so the destination
  // note is resolved by resolveSnipTargetNoteId — see its doc comment in
  // piece-ai.ts for the fallback chain and why this doesn't touch the data
  // model.
  const handleRefineSnip = useCallback(
    (selectionStart: number, selectionEnd: number) => {
      const body = piece.body ?? "";
      const selectedText = body.slice(selectionStart, selectionEnd);
      if (!selectedText.trim()) return;

      const noteIds = new Set(Object.keys(notes));
      const targetNoteId = resolveSnipTargetNoteId(piece.ideaId, Object.values(allPieces), noteIds, activeNoteId);
      if (!targetNoteId) {
        showToast("Link this idea to a note, or open one, before snipping.");
        return;
      }

      const snippetId = addSnippet(targetNoteId, selectedText, undefined, piece.ideaId);
      labelSnippet(snippetId, selectedText, idea?.summary ?? "", idea?.title ?? "", targetNoteId);

      const nextBody = body.slice(0, selectionStart) + body.slice(selectionEnd);
      updatePiece(piece.id, { body: nextBody });
    },
    [piece, notes, allPieces, activeNoteId, addSnippet, idea, labelSnippet, showToast, updatePiece],
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
      ref={cardRef}
      data-piece-card
      data-piece-id={piece.id}
      onClick={onFocusCard}
      onMouseEnter={() => setHoveredPiece(piece.id)}
      onMouseLeave={() => setHoveredPiece(null)}
      className={`relative flex flex-col h-full min-h-0 pl-5 pr-2 py-4 transition-colors duration-150 rounded-[var(--radius-default)] ${
        focused ? "bg-surface-2/40" : ""
      }`}
    >
      {/* Page marker for the focused piece. Softened from the old card-height
          rail: at a full page tall, a solid gold bar reads as an alert. */}
      {focused && (
        <div className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-gold/50" />
      )}

      {/* Meta row — pinned to the top of the page */}
      <div className="shrink-0 flex items-center gap-2.5 mb-2 flex-wrap">
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

        {piece.scheduledAt !== undefined && (
          <span
            className={`font-mono text-[10px] ${scheduleOverdue(piece, now) ? "text-gold" : "text-text-faint"}`}
            title={scheduleOverdue(piece, now) ? "Scheduled time passed without a publish" : "Scheduled"}
          >
            {scheduleLabel(piece.scheduledAt)}
          </span>
        )}

        <span
          title={`Piece ${position} of ${total} in this view`}
          className="ml-auto text-[10px] font-[family-name:var(--font-mono)] text-text-faint"
        >
          {position}/{total}
        </span>

        <span className={`flex items-center gap-1.5 text-[11px] ${staleClass}`}>
          {!piece.seen && (
            <span
              className="w-1.5 h-1.5 rounded-full bg-gold"
              style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
            />
          )}
          {STATUS_LABELS[piece.status]} {ageLabel(piece, now)}
        </span>
      </div>

      {/* Body — two views of the same byte-exact string. Reading shows it
          rendered (headings, bold, lists, links); clicking in swaps to the
          raw markdown in a plain auto-growing textarea, so what you edit is
          exactly what gets published. Never Tiptap: the stored text is never
          rewritten by a rendering pass. During Flow generation the value
          follows streamedBody (local state) instead of the store, matching
          the long-form editor's streamingContent pattern — see
          handleFlowGenerate. */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-3 -mr-1">
        {isEditing ? (
          <>
            <LiveMarkdownTextarea
              textareaRef={textareaRef}
              value={flowGenerating ? streamedBody ?? "" : piece.body ?? ""}
              onChange={handleBodyChange}
              onFocus={enterEditing}
              onBlur={onExitEdit}
              onKeyDown={handleTextareaKeyDown}
              readOnly={flowGenerating}
              placeholder={slashEnabled ? "Write, or press ⌘⏎ to draft with Flow" : "Write the piece..."}
            />
            {inlineEditEnabled && !flowGenerating && (
              <PieceRefineMenu
                textareaRef={textareaRef}
                containerRef={cardRef}
                onEdit={handleRefineEdit}
                onSnip={handleRefineSnip}
              />
            )}
          </>
        ) : body.trim() ? (
          <div
            onClick={enterEditing}
            title="Click to edit the raw markdown"
            className="prose-preview shortform-piece-rendered text-[14px] leading-relaxed text-text-primary font-[family-name:var(--font-body)] cursor-text"
            // Safe: markdownToPreviewHtml runs markdown-it with html:false,
            // so any raw HTML in an agent-pushed body is escaped, not
            // injected.
            dangerouslySetInnerHTML={{ __html: markdownToPreviewHtml(body) }}
          />
        ) : (
          <div
            onClick={enterEditing}
            className="text-[14px] leading-relaxed text-text-faint font-[family-name:var(--font-body)] cursor-text"
          >
            {slashEnabled ? "Write, or press ⌘⏎ to draft with Flow" : "Write the piece..."}
          </div>
        )}
      </div>

      {/* Triage — only while the piece is still sitting in the inbox. */}
      {piece.status === "inbox" && !flowGenerating && (
        <div className="shrink-0">
          <PieceTriageBar piece={piece} onDismiss={onDelete} />
        </div>
      )}

      {/* Footer — pinned to the bottom of the page */}
      <div className="shrink-0 flex items-center gap-3 mt-2.5 pt-2.5 border-t border-border">
        <span className={`text-[10px] font-[family-name:var(--font-mono)] ${footer.over ? "text-red" : "text-text-faint"}`}>
          {footer.text}
        </span>

        {flowGenerating && (
          <button
            onClick={(e) => { e.stopPropagation(); handleFlowStop(); }}
            title="Stop generating and keep what's been written"
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-sm)] border border-gold/30 bg-gold/5 text-[11px] text-gold hover:bg-gold/10 transition-all duration-150"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-gold" style={{ animation: "pulse-gold 1.2s ease-in-out infinite" }} />
            Stop
          </button>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <PieceShareMenu piece={piece} />

          <div ref={overflowAnchorRef} className="relative">
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
                ref={overflowMenuRef}
                className={`absolute right-0 ${menuPlacement.className} z-20 w-40 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl py-1 overflow-y-auto`}
                style={{ maxHeight: menuPlacement.maxHeight || undefined }}
                onMouseLeave={() => { setMenuOpen(false); setPriorityMenuOpen(false); }}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setPriorityMenuOpen(false);
                    setResourcesOpen(true);
                  }}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
                  title="Reference links, notes, and assets for this piece — including inherited from its idea"
                >
                  Resources
                </button>
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setPriorityMenuOpen(false);
                    handleFlowGenerate();
                  }}
                  disabled={!slashEnabled || flowGenerating}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none"
                  title={
                    !slashEnabled
                      ? "Flow is off — turn on slash commands in Settings → AI"
                      : flowGenerating
                        ? "Already generating"
                        : "Generate a first draft for this piece with AI (⌘⏎)"
                  }
                >
                  Draft with Flow
                </button>
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

            {resourcesOpen && (
              <PieceResourcesPopover pieceId={piece.id} anchorRef={overflowAnchorRef} onClose={() => setResourcesOpen(false)} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
