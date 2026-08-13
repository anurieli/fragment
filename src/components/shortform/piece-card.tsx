"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { Flag, MoreHorizontal, Pin } from "lucide-react";
import type { ContentFormat, ContentPiece } from "@/lib/content-engine";
import { PLATFORM_CHAR_LIMITS, TWEET_CHAR_LIMIT, charCount, countTweetThread, markdownToPreviewHtml } from "@/lib/publish";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useToastStore } from "@/hooks/use-toast";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { useSlashCommand } from "@/hooks/use-slash-command";
import { useSnipLabeler } from "@/hooks/use-snip-labeler";
import { useResolvedBrief } from "@/hooks/use-brief";
import {
  buildRefineContext,
  buildFlowContext,
  FORMAT_TO_PLATFORM,
} from "@/lib/piece-ai";
import { buildIdeaBrief } from "@/lib/ai-context";
import { PRIORITY_META } from "@/lib/priority";
import { effectiveResourcesForIdea } from "@/stores/resources-selectors";
import {
  moveTextareaSelection,
  offsetAtPoint,
  pointInTextareaSelection,
  selectionDragDestination,
  textareaSelectionRange,
} from "@/lib/textarea-selection";
import { titleFromText } from "@/lib/derive-title";
import { formatDate } from "@/lib/utils";
import { ageLabel, scheduleLabel, scheduleOverdue, stalenessLevel } from "./feed-logic";
import { PieceResourcesPopover } from "./piece-resources-popover";
import { PieceShareMenu } from "./piece-share-menu";
import { PieceRefineMenu } from "./piece-refine-menu";
import { PieceTriageBar } from "./piece-triage";
import { PieceMenuItems } from "./piece-menu-items";
import { ContextMenu, useContextMenu } from "@/components/common/context-menu";
import { PublishReceipt } from "@/components/publish/publish-receipt";
import { PublishedLock, isPieceLocked } from "@/components/publish/published-lock";
import { PublishPendingPrompt } from "@/components/publish/publish-pending-prompt";
import { FORMAT_LABELS } from "@/lib/format-labels";
import { LiveMarkdownTextarea } from "./live-markdown-textarea";

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
  const duplicatePiece = useContentStore((s) => s.duplicatePiece);
  const markPieceSeen = useContentStore((s) => s.markPieceSeen);
  const cyclePiecePriority = useContentStore((s) => s.cyclePiecePriority);
  const ideas = useContentStore((s) => s.ideas);
  const allPieces = useContentStore((s) => s.pieces);
  const allIdeas = useContentStore((s) => s.ideas);
  const allResources = useContentStore((s) => s.resources);
  const addSnippet = useDataStore((s) => s.addSnippet);
  const pinHelperBar = useAppStore((s) => s.pinHelperBar);
  const setHoveredPiece = useAppStore((s) => s.setHoveredPiece);
  const showToast = useToastStore((s) => s.showToast);
  const { edit: inlineEdit, enabled: inlineEditEnabled } = useInlineEdit();
  const { generateStream, abort: abortFlow, enabled: slashEnabled } = useSlashCommand();
  const labelSnip = useSnipLabeler();
  const idea = ideas[piece.ideaId];
  // Fragment → idea → voice. Short-form used to send empty audience and tone,
  // so a piece drafted here ignored the persona entirely.
  const brief = useResolvedBrief(piece);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const overflowAnchorRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  // The footer this hangs off is pinned to the bottom of the page.
  const menuPlacement = useMenuPlacement(menuOpen, overflowAnchorRef, overflowMenuRef);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  // Right-click anywhere on the card opens the same list of actions the ⋯
  // button holds, at the pointer. The one exception is inside the textarea,
  // where the browser's own menu still owns spellcheck, cut and paste.
  const { point: contextPoint, openAt: openContextMenu, close: closeContextMenu } = useContextMenu();
  // Flow (⌘⏎ / "Draft with Flow"): streamedBody mirrors the long-form
  // editor's streamingContent pattern (editor.tsx) — chunks accumulate in
  // local state and only commit to the store (updatePiece) once generation
  // finishes, so IndexedDB isn't written on every animation frame.
  const [flowGenerating, setFlowGenerating] = useState(false);
  const [streamedBody, setStreamedBody] = useState<string | null>(null);
  // Flow asks before it writes. It used to fire the moment ⌘⏎ was pressed,
  // with a canned instruction nobody typed, so opening a piece and reaching
  // for a keyboard shortcut produced a page of text out of nowhere. The
  // shortcut opens this line instead; generation needs words in it.
  const [flowPrompt, setFlowPrompt] = useState<string | null>(null);
  const flowPromptRef = useRef<HTMLInputElement>(null);

  // The one string this card is about, from whichever source is live.
  const body = flowGenerating ? streamedBody ?? "" : piece.body ?? "";
  // Flow streams into the textarea, so a generating card counts as editing
  // even if the user never clicked in.
  const isEditing = editing || flowGenerating;
  // "Edit anyway" on a published card. Holds the piece id rather than a boolean
  // so switching cards re-locks by itself, with no effect resetting anything:
  // the unlock is transient on purpose, because publishing is why the text is
  // closed and reading a different piece does not change that.
  const [unlockedPieceId, setUnlockedPieceId] = useState<string | null>(null);
  const locked = isPieceLocked(piece, unlockedPieceId === piece.id);

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
    // A published card is read-only, so clicking its text marks it seen and
    // then does nothing else. The notice above it says why, and offers the two
    // ways forward, rather than a click silently failing to put a caret in.
    if (locked) return;
    onEnterEdit();
  }, [piece.seen, piece.id, markPieceSeen, onEnterEdit, locked]);

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
  /** Open the prompt line. Flow never starts from a keystroke alone. */
  const openFlowPrompt = useCallback(() => {
    if (flowGenerating) return;
    // Silence was the worst answer here: ⌘⏎ with Flow switched off did
    // nothing at all, which reads as a broken feature rather than an off one.
    if (!slashEnabled) {
      showToast("Flow is off. Turn on slash commands in Settings, AI.");
      return;
    }
    setFlowPrompt("");
    requestAnimationFrame(() => flowPromptRef.current?.focus());
  }, [flowGenerating, slashEnabled, showToast]);

  const handleFlowGenerate = useCallback((instruction: string) => {
    if (flowGenerating) return;
    if (!slashEnabled) return;
    if (!instruction.trim()) return;
    setFlowPrompt(null);
    // Everything the idea holds: its title and summary, what is already
    // written in it, and the sources attached to it. Flow used to receive
    // only "the idea's long-form draft", which assumed each idea has exactly
    // one long piece that counts, and left a model writing blind whenever it
    // did not.
    const ideaBrief = buildIdeaBrief({
      idea: idea ? { title: idea.title ?? "", summary: idea.summary } : null,
      siblings: Object.values(allPieces).filter(
        (p) => p.ideaId === piece.ideaId && p.id !== piece.id && p.deletedAt === undefined,
      ),
      resources: effectiveResourcesForIdea(
        piece.ideaId,
        Object.values(allIdeas),
        Object.values(allResources),
      ),
    });
    const ctx = buildFlowContext({ format: piece.format, idea, ideaBrief, instruction, brief });
    const baseBody = piece.body ?? "";

    setFlowGenerating(true);
    setStreamedBody(baseBody);

    generateStream(
      ctx.contextAbove,
      "",
      ctx.goal,
      ctx.audience,
      ctx.tone,
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
    allIdeas,
    allResources,
    idea,
    brief,
    generateStream,
    updatePiece,
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
        openFlowPrompt();
      } else if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        // "/" at the start of a line opens Flow, the same gesture the
        // long-form editor has had all along. In a piece it did nothing at
        // all, so the shortcut a writer had already learned looked broken
        // here. Mid-word and mid-sentence slashes are left alone: dates and
        // and/or are ordinary typing.
        const el = e.currentTarget;
        const before = el.value.slice(0, el.selectionStart ?? 0);
        const atLineStart = before === "" || before.endsWith("\n");
        if (atLineStart && el.selectionStart === el.selectionEnd) {
          e.preventDefault();
          openFlowPrompt();
        }
      }
    },
    [onExitEdit, openFlowPrompt],
  );

  // Refine: context-aware edit of the current textarea selection, routed
  // through the existing useInlineEdit flow. See buildRefineContext in
  // piece-ai.ts for how before/after context, the idea's title/summary, the
  // voice chain (fragment.voiceId -> idea.voiceId -> default) and the
  // platform/char-limit hint are assembled. Goal, audience and tone come from
  // the resolved brief, so a short-form fragment sees the same persona the
  // editor does; they used to be passed as empty strings from here.
  const handleRefineEdit = useCallback(
    async (instruction: string, selectionStart: number, selectionEnd: number): Promise<string | null> => {
      if (!inlineEditEnabled) return null;
      const body = piece.body ?? "";
      const selection = textareaSelectionRange(body, selectionStart, selectionEnd);
      if (!selection) return null;
      const selectedText = body.slice(selection.start, selection.end);
      if (!selectedText.trim()) return null;
      const ctx = buildRefineContext({
        format: piece.format,
        body,
        selectionStart: selection.start,
        selectionEnd: selection.end,
        idea,
        brief,
      });
      return inlineEdit(
        selectedText,
        ctx.contextBefore,
        ctx.contextAfter,
        ctx.goal,
        ctx.audience,
        ctx.tone,
        ctx.remember,
        instruction,
        piece.id,
        ctx.voiceId,
      );
    },
    [inlineEditEnabled, piece, idea, brief, inlineEdit],
  );

  // Snip out: lifts the selection into the Snip Bar, filed against this
  // piece's idea. It used to need a note to file against and refused the snip
  // when it couldn't find one — which is most of the time, since an idea full
  // of agent-pushed pieces has no draft at all. Snippets are idea-scoped now
  // (see snip-scope.ts), so this always has a home.
  const snipOut = useCallback(
    (
      selectionStart: number,
      selectionEnd: number,
      atIndex?: number,
      dragStartBody?: string,
    ) => {
      const currentPiece = useContentStore.getState().pieces[piece.id];
      if (!currentPiece) return;
      const body = currentPiece.body ?? "";
      if (dragStartBody !== undefined && body !== dragStartBody) return;
      const selection = textareaSelectionRange(body, selectionStart, selectionEnd);
      if (!selection) return;
      const selectedText = body.slice(selection.start, selection.end);
      if (!selectedText.trim()) return;

      const snippetId = addSnippet(null, selectedText, atIndex, piece.ideaId);
      if (!snippetId) return;
      labelSnip(snippetId, selectedText, { pieceId: null, ideaId: piece.ideaId });

      updatePiece(piece.id, {
        body: body.slice(0, selection.start) + body.slice(selection.end),
      });
      // Show where it went. Cutting text out of the page and dropping it into
      // a panel that is closed (the bar auto-hides) is what made this read as
      // a no-op, so the bar comes out and stays out — the same move the
      // long-form editor makes on its Snip button.
      pinHelperBar();
    },
    [piece, addSnippet, labelSnip, updatePiece, pinHelperBar],
  );

  const handleRefineSnip = useCallback(
    (selectionStart: number, selectionEnd: number) => snipOut(selectionStart, selectionEnd),
    [snipOut],
  );

  /**
   * Lift the selection into a piece of its own, in the same idea. Unlike Snip
   * it takes nothing away from this card: a second post hiding inside the one
   * you are writing should become its own card without gutting this one.
   */
  const handleCapturePiece = useCallback(
    (selectionStart: number, selectionEnd: number) => {
      const selectedText = (piece.body ?? "").slice(selectionStart, selectionEnd).trim();
      if (!selectedText) return;

      const content = useContentStore.getState();
      const newId = content.createPiece({
        ideaId: piece.ideaId,
        format: "other",
        origin: "user",
        // Yours, written just now: already triaged by the act of writing it.
        status: "in-progress",
        body: selectedText,
        seen: true,
      });
      if (!newId) return;

      showToast(`Piece created: ${titleFromText(selectedText) || "Untitled"}`, {
        label: "Open",
        onClick: () => useAppStore.getState().revealPiece(newId),
      });
    },
    [piece.body, piece.ideaId, showToast],
  );

  // Kept in a ref because the drag's mouseup fires from a document listener
  // installed once, at mousedown, and must not act on a stale piece body.
  const snipOutRef = useRef(snipOut);
  useEffect(() => { snipOutRef.current = snipOut; }, [snipOut]);

  /**
   * Drag a selection out to the Snip Bar — the same gesture the long-form
   * editor has, which a piece simply didn't answer before: the bar is hidden
   * until something says a drag is under way, so dragging text out of a piece
   * aimed at a panel that was never there.
   *
   * Mouse events, not HTML5 drag-and-drop, for the reason editor.tsx gives:
   * the native text-drag ghost can't be overridden in WebKit/Tauri. Hit
   * testing the selection goes through the markdown mirror, which is the only
   * thing that knows where a textarea's selection is on screen.
   */
  const handleTextareaMouseDown = useCallback(
    (e: React.MouseEvent<HTMLTextAreaElement>) => {
      if (e.button !== 0 || flowGenerating) return;
      const el = textareaRef.current;
      if (!el || el.selectionStart === el.selectionEnd) return;
      if (!pointInTextareaSelection(el, mirrorRef.current, e.clientX, e.clientY)) return;

      const start = el.selectionStart;
      const end = el.selectionEnd;
      const dragStartBody = useContentStore.getState().pieces[piece.id]?.body ?? piece.body ?? "";
      const selection = textareaSelectionRange(dragStartBody, start, end);
      if (!selection) return;
      const text = dragStartBody.slice(selection.start, selection.end);
      if (!text.trim()) return;

      // Hold the selection and suppress the native drag ghost.
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const cleanup = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      const onMove = (ev: MouseEvent) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
          dragging = true;
          useAppStore.getState().setDraggingToHelper(true);
          useAppStore.getState().setFloatingDragCard({
            content: text,
            label: null,
            labelStatus: "idle",
          });
        }
        const card = document.querySelector("[data-floating-card]") as HTMLElement | null;
        if (card) {
          card.style.transform = `translate(${ev.clientX + 16}px, ${ev.clientY + 16}px)`;
          card.style.opacity = "1";
        }
      };

      const onUp = (ev: MouseEvent) => {
        cleanup();
        if (!dragging) {
          // A click, not a drag. The mousedown that would have moved the
          // caret was swallowed to hold the selection, so put it where the
          // click actually landed — same contract as the editor's mouseup
          // handler.
          const offset = offsetAtPoint(mirrorRef.current, ev.clientX, ev.clientY, el);
          if (el && offset !== null) {
            el.focus();
            el.setSelectionRange(offset, offset);
          }
          return;
        }

        const dropZone = document.querySelector("[data-snip-bar-drop-zone]");
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const destination = selectionDragDestination(el, dropZone, over);
        if (destination === "snip-bar" && dropZone) {
          const idxAttr = dropZone.getAttribute("data-drop-index");
          const dropIdx = idxAttr ? parseInt(idxAttr, 10) : NaN;
          snipOutRef.current(
            start,
            end,
            Number.isFinite(dropIdx) ? dropIdx : undefined,
            dragStartBody,
          );
        } else if (destination === "source") {
          const dropOffset = offsetAtPoint(
            mirrorRef.current,
            ev.clientX,
            ev.clientY,
            el,
          );
          if (dropOffset !== null) {
            const currentBody = useContentStore.getState().pieces[piece.id]?.body ?? "";
            const moved = moveTextareaSelection(
              currentBody,
              dragStartBody,
              start,
              end,
              dropOffset,
            );
            if (moved) {
              updatePiece(piece.id, { body: moved.value });
              requestAnimationFrame(() => {
                const textarea = textareaRef.current;
                if (!textarea) return;
                textarea.focus();
                textarea.setSelectionRange(moved.selectionStart, moved.selectionEnd);
              });
            }
          }
        }

        useAppStore.getState().setDraggingToHelper(false);
        useAppStore.getState().setFloatingDragCard(null);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [flowGenerating, piece.body, piece.id, updatePiece],
  );

  const flowDisabledReason = !slashEnabled
    ? "Flow is off. Turn on slash commands in Settings, AI"
    : flowGenerating
      ? "Already generating"
      : undefined;

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
      onContextMenu={(e) => {
        // Text fields keep the browser's menu: inside the textarea a
        // right-click is about the words (paste, spellcheck), not the piece.
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "TEXTAREA" || tag === "INPUT") return;
        onFocusCard();
        openContextMenu(e);
      }}
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

      {contextPoint && (
        <ContextMenu point={contextPoint} onClose={closeContextMenu}>
          <PieceMenuItems
            piece={piece}
            onClose={closeContextMenu}
            onDelete={onDelete}
            onWriteWithFlow={openFlowPrompt}
            flowDisabledReason={flowDisabledReason}
            onOpenResources={() => setResourcesOpen(true)}
          />
        </ContextMenu>
      )}

      {/* Meta row — pinned to the top of the page */}
      <div className="shrink-0 flex items-center gap-2.5 mb-2 flex-wrap">
        {piece.pinnedAt !== undefined && (
          <span title="Pinned to the top of this idea's feed" className="shrink-0 text-gold">
            <Pin size={10} fill="currentColor" />
          </span>
        )}

        {piece.archivedAt !== undefined && (
          <span
            title="Archived. It only shows under the Archived filter"
            className="text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-faint px-1.5 py-0.5 rounded-[4px] bg-surface-2 border border-border"
          >
            Archived
          </span>
        )}

        <span className="text-[10px] font-[family-name:var(--font-mono)] uppercase tracking-wider text-text-muted px-1.5 py-0.5 rounded-[4px] bg-surface-2 border border-border">
          {platformChip(piece.format)}
        </span>

        <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[piece.status].dotClass}`} />
          {STATUS_META[piece.status].label}
        </span>

        {/* Where it went and when, linked when a URL is on file. "Published" on
            its own never answered either question. */}
        {piece.publish && <PublishReceipt publish={piece.publish} />}

        {/* Between pressing publish and the piece being live. Opens a field for
            the published link, because the publish itself happened in another
            tab and pasting the URL beats inferring it. See
            PublishPendingPrompt. */}
        <PublishPendingPrompt piece={piece} now={now} />

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
      {flowPrompt !== null && (
        <div className="px-1 pb-2">
          <div className="flex items-center gap-2 rounded-[var(--radius-default)] border border-gold/50 bg-gold-muted/10 px-3 py-2">
            <span className="text-[11px] font-medium text-gold shrink-0">Flow</span>
            <input
              ref={flowPromptRef}
              value={flowPrompt}
              onChange={(e) => setFlowPrompt(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Escape") {
                  e.preventDefault();
                  setFlowPrompt(null);
                  textareaRef.current?.focus();
                } else if (e.key === "Enter" && flowPrompt.trim()) {
                  e.preventDefault();
                  handleFlowGenerate(flowPrompt);
                }
              }}
              placeholder="What should Flow write here?"
              className="flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-faint outline-none"
            />
            <span className="text-[10px] text-text-faint shrink-0 font-[family-name:var(--font-mono)]">
              enter to write, esc to cancel
            </span>
          </div>
        </div>
      )}

      {locked && (
        <div className="shrink-0">
          <PublishedLock
            piece={piece}
            variant="inline"
            onEditAnyway={() => setUnlockedPieceId(piece.id)}
            onDuplicate={() => {
              const copyId = duplicatePiece(piece.id);
              if (copyId) showToast("Duplicated. The copy is unpublished and open to edit.");
            }}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-3 -mr-1">
        {isEditing ? (
          <>
            <LiveMarkdownTextarea
              textareaRef={textareaRef}
              mirrorRef={mirrorRef}
              onMouseDown={handleTextareaMouseDown}
              value={flowGenerating ? streamedBody ?? "" : piece.body ?? ""}
              onChange={handleBodyChange}
              onFocus={enterEditing}
              onBlur={onExitEdit}
              onKeyDown={handleTextareaKeyDown}
              readOnly={flowGenerating || locked}
              placeholder={slashEnabled ? "Write, or press / to ask Flow" : "Write the piece..."}
            />
            {inlineEditEnabled && !flowGenerating && (
              <PieceRefineMenu
                textareaRef={textareaRef}
                containerRef={cardRef}
                onEdit={handleRefineEdit}
                onSnip={handleRefineSnip}
                onCapturePiece={handleCapturePiece}
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
              }}
              className="p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
            >
              <MoreHorizontal size={14} />
            </button>

            {menuOpen && (
              <div
                ref={overflowMenuRef}
                className={`absolute right-0 ${menuPlacement.className} z-20 w-48 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl py-1 overflow-y-auto`}
                style={{ maxHeight: menuPlacement.maxHeight || undefined }}
                onMouseLeave={() => setMenuOpen(false)}
              >
                <PieceMenuItems
                  piece={piece}
                  onClose={() => setMenuOpen(false)}
                  onDelete={onDelete}
                  onWriteWithFlow={openFlowPrompt}
                  flowDisabledReason={flowDisabledReason}
                  onOpenResources={() => setResourcesOpen(true)}
                />
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
