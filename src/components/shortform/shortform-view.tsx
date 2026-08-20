"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { UIEvent as ReactUIEvent } from "react";
import type { ContentPiece } from "@/lib/content-engine";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { hierarchyRollup, shortformOnly } from "@/stores/content-selectors";
import { useToastStore } from "@/hooks/use-toast";
import { discardPendingEmptyPiece } from "@/hooks/use-empty-creation-cleanup";
import { IdeaPanelToggle } from "@/components/idea/idea-panel";
import { SpaceToggle } from "./space-toggle";
import { PieceFilterBar } from "./piece-filter-bar";
import { ShortformFeed } from "./shortform-feed";
import { ShortformEmptyState } from "./shortform-empty-state";
import { IdeaResources } from "./idea-resources";
import {
  PIECE_FILTERS,
  defaultSortForFilter,
  filterCounts,
  nextStatus,
  rovingNext,
  rovingPrev,
  visiblePieces,
  type PieceFilter,
  type PieceSortMode,
} from "./feed-logic";

interface ShortformViewProps {
  ideaId: string;
}

type FocusMode = "roving" | "editing";

/**
 * Top-level container for the "Pieces" space: the space toggle + filter bar
 * + free-scroll feed for one idea. Viewing a parent idea rolls up its
 * children's pieces (hierarchyRollup); selecting a child idea directly in
 * the sidebar narrows to just that idea (ideaId here is whatever's active,
 * root or child — hierarchyRollup handles both since a child can't itself
 * have children, per the depth-2 cap).
 */
export function ShortformView({ ideaId }: ShortformViewProps) {
  const idea = useContentStore((s) => s.ideas[ideaId]);
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);
  const createPiece = useContentStore((s) => s.createPiece);
  const setPieceStatus = useContentStore((s) => s.setPieceStatus);
  const acceptExtractedPiece = useContentStore((s) => s.acceptExtractedPiece);
  const cyclePiecePriority = useContentStore((s) => s.cyclePiecePriority);
  const rejectPiece = useContentStore((s) => s.rejectPiece);
  const undeletePiece = useContentStore((s) => s.undeletePiece);
  const showToast = useToastStore((s) => s.showToast);
  const revealPieceId = useAppStore((s) => s.revealPieceId);
  const clearRevealPiece = useAppStore((s) => s.clearRevealPiece);
  const setFocusedPiece = useAppStore((s) => s.setFocusedPiece);
  const setHoveredPiece = useAppStore((s) => s.setHoveredPiece);

  const [filter, setFilterRaw] = useState<PieceFilter>("all");
  const [sort, setSort] = useState<PieceSortMode>(defaultSortForFilter("all"));
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [mode, setMode] = useState<FocusMode>("roving");
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const scrollFocusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusedIndexRef = useRef(focusedIndex);

  useEffect(() => {
    focusedIndexRef.current = focusedIndex;
    // A click, keyboard move, panel jump, or edit-mode change is newer intent
    // than any manual-scroll settle still waiting to run.
    if (scrollFocusTimer.current !== null) {
      clearTimeout(scrollFocusTimer.current);
      scrollFocusTimer.current = null;
    }
  }, [focusedIndex, mode]);

  // Refresh "age"/"stale" tokens periodically — cheap, and keeps long-idle
  // sessions from showing a frozen relative time.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Short-form only: the idea's long-form drafts live in the Write space and
  // are edited in the editor, so they never appear as cards here.
  const rollup = useMemo(
    () => shortformOnly(hierarchyRollup(ideaId, Object.values(ideas), Object.values(pieces))),
    [ideaId, ideas, pieces],
  );
  const counts = useMemo(() => filterCounts(rollup), [rollup]);
  const visible = useMemo(() => visiblePieces(rollup, filter, sort), [rollup, filter, sort]);
  const focusedPieceId = focusedIndex >= 0 ? visible[focusedIndex]?.id ?? null : null;

  const setFilter = useCallback((next: PieceFilter) => {
    setFilterRaw(next);
    setSort(defaultSortForFilter(next));
    setFocusedIndex(-1);
    setMode("roving");
  }, []);

  // Open on the Inbox when there's an inbox to clear. The point of an inbox
  // is to reach zero, and you can't clear what you aren't looking at — "All"
  // buries the three new agent drafts among forty triaged ones. One-shot per
  // idea, so it never fights a filter the user picked afterwards.
  const filterInitialisedFor = useRef<string | null>(null);
  useEffect(() => {
    if (filterInitialisedFor.current === ideaId) return;
    filterInitialisedFor.current = ideaId;
    if (counts.extracted > 0) setFilter("extracted");
    else if (counts.inbox > 0) setFilter("inbox");
  }, [ideaId, counts.extracted, counts.inbox, setFilter]);

  // Keep roving focus in range as the list changes (delete, filter, sort).
  useEffect(() => {
    if (focusedIndex >= visible.length) {
      setFocusedIndex(visible.length - 1);
    }
  }, [visible.length, focusedIndex]);

  // Once a just-created piece appears in the visible list, focus + edit it.
  useEffect(() => {
    if (!pendingFocusId) return;
    const idx = visible.findIndex((p) => p.id === pendingFocusId);
    if (idx !== -1) {
      setFocusedIndex(idx);
      setMode("editing");
      setPendingFocusId(null);
    }
  }, [pendingFocusId, visible]);

  // Keep the focused piece on screen, and tell the rest of the app which one
  // it is so the idea workspace can mark it. Roving with J/K, or arriving
  // from the panel, should always land a whole page.
  useEffect(() => {
    setFocusedPiece(focusedPieceId);
    if (!focusedPieceId) return;
    document
      .querySelector(`[data-piece-card][data-piece-id="${focusedPieceId}"]`)
      ?.closest("[data-piece-page]")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusedPieceId, setFocusedPiece]);

  // Leaving the Pieces space clears both markers — a stale "you are here"
  // pointing at a feed nobody is looking at is worse than none.
  useEffect(() => {
    return () => {
      if (scrollFocusTimer.current !== null) clearTimeout(scrollFocusTimer.current);
      setFocusedPiece(null);
      setHoveredPiece(null);
    };
  }, [setFocusedPiece, setHoveredPiece]);

  // CSS scroll snap moves the viewport without going through the roving-focus
  // controls. Once the snap settles, make the page that actually landed the
  // focused page too. Otherwise a later piece update re-runs the focused-piece
  // effect above and scrolls the deck back to the stale page.
  const handleFeedScroll = useCallback((event: ReactUIEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    if (scrollFocusTimer.current !== null) clearTimeout(scrollFocusTimer.current);
    scrollFocusTimer.current = setTimeout(() => {
      scrollFocusTimer.current = null;
      const pages = Array.from(
        container.querySelectorAll<HTMLElement>("[data-piece-page]"),
      );
      if (pages.length === 0) return;

      const containerTop = container.getBoundingClientRect().top;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;
      pages.forEach((page, index) => {
        const distance = Math.abs(page.getBoundingClientRect().top - containerTop);
        if (distance < nearestDistance) {
          nearestIndex = index;
          nearestDistance = distance;
        }
      });

      if (nearestIndex !== focusedIndexRef.current) {
        focusedIndexRef.current = nearestIndex;
        setFocusedIndex(nearestIndex);
        setMode("roving");
      }
    }, 120);
  }, []);

  // A click in the idea workspace names a piece; land on it here. If the
  // current filter hides it, widen to All first and resolve on the next pass.
  useEffect(() => {
    if (!revealPieceId) return;
    const idx = visible.findIndex((p) => p.id === revealPieceId);
    if (idx === -1) {
      const target = rollup.find((piece) => piece.id === revealPieceId);
      if (target?.reviewQueue === "extraction" && filter !== "extracted") setFilter("extracted");
      else if (filter !== "all") setFilter("all");
      else clearRevealPiece();
      return;
    }
    setFocusedIndex(idx);
    setMode("roving");
    clearRevealPiece();
    document
      .querySelector(`[data-piece-card][data-piece-id="${revealPieceId}"]`)
      ?.closest("[data-piece-page]")
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [revealPieceId, visible, rollup, filter, setFilter, clearRevealPiece]);

  const handleNewPiece = useCallback(() => {
    const id = createPiece({
      ideaId,
      format: "other",
      origin: "user",
      status: "in-progress",
      body: "",
      seen: true,
    });
    if (!id) return;
    // You just made this, so it starts in progress rather than in the inbox.
    // A narrower filter would hide the card the instant it appeared, so widen
    // to "all" unless the writer is already looking at in-progress.
    if (filter !== "all" && filter !== "in-progress") setFilter("all");
    setPendingFocusId(id);
  }, [createPiece, ideaId, filter, setFilter]);

  const handleDelete = useCallback(
    (piece: ContentPiece) => {
      rejectPiece(piece.id);
      showToast("Piece deleted", { label: "Undo", onClick: () => undeletePiece(piece.id) });
    },
    [rejectPiece, showToast, undeletePiece],
  );

  const handleExitEdit = useCallback(() => {
    const focusedPiece = focusedIndex >= 0 ? visible[focusedIndex] : undefined;
    if (focusedPiece) discardPendingEmptyPiece(focusedPiece.id);
    setMode("roving");
  }, [focusedIndex, visible]);

  // Keyboard model: J/K or arrows rove focus, Enter/Esc toggle edit mode, S/P
  // cycle status/priority, C copies exact text, N creates a piece, 1-6 jump
  // filters, Backspace deletes with an undo toast. Textareas stay out of the
  // tab order (tabIndex={-1} in piece-card.tsx) — this listener is the only
  // way to reach them via keyboard, by design.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (mode === "editing") return; // the focused textarea owns its own keys
      const activeTag = (document.activeElement?.tagName ?? "").toUpperCase();
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const focusedPiece = focusedIndex >= 0 ? visible[focusedIndex] : undefined;

      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setFocusedIndex((i) => rovingNext(i, visible.length));
          return;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setFocusedIndex((i) => rovingPrev(i, visible.length));
          return;
        case "Enter":
          if (focusedPiece) { e.preventDefault(); setMode("editing"); }
          return;
        case "s":
        case "S":
          if (focusedPiece) {
            e.preventDefault();
            if (focusedPiece.reviewQueue === "extraction") acceptExtractedPiece(focusedPiece.id);
            else setPieceStatus(focusedPiece.id, nextStatus(focusedPiece.status));
          }
          return;
        case "p":
        case "P":
          if (focusedPiece && focusedPiece.reviewQueue === undefined) {
            e.preventDefault();
            cyclePiecePriority(focusedPiece.id);
          }
          return;
        case "c":
        case "C":
          if (focusedPiece) {
            e.preventDefault();
            navigator.clipboard?.writeText(focusedPiece.body ?? "").catch(() => {});
          }
          return;
        case "n":
        case "N":
          e.preventDefault();
          handleNewPiece();
          return;
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6": {
          e.preventDefault();
          const next = PIECE_FILTERS[Number(e.key) - 1];
          if (next) setFilter(next);
          return;
        }
        case "Backspace":
          if (focusedPiece) { e.preventDefault(); handleDelete(focusedPiece); }
          return;
        default:
          return;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mode, focusedIndex, visible, setPieceStatus, acceptExtractedPiece, cyclePiecePriority, handleNewPiece, handleDelete, setFilter]);

  return (
    <div data-shortform-view className="flex-1 min-w-0 flex flex-col min-h-0">
      {/* Toolbar — mirrors the editor's toolbar position/padding so the
          space toggle stays in the same spot switching Write <-> Pieces. */}
      <div className="flex items-center px-8 pt-6 pb-3 shrink-0 gap-3 min-w-0">
        <IdeaPanelToggle />
        <SpaceToggle ideaId={ideaId} />
        <div className="flex-1 min-w-0 flex items-baseline gap-2 overflow-hidden">
          <span className="truncate text-[13px] text-text-secondary">
            {idea?.title || "Untitled idea"}
          </span>
          <span className="shrink-0 text-[11px] text-text-faint">
            short-form pieces. Snip one out, or let an agent drop a draft in the inbox
          </span>
        </div>
      </div>

      <PieceFilterBar
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        sort={sort}
        onSortChange={setSort}
        onNewPiece={handleNewPiece}
      />

      <div className="shrink-0 border-b border-[var(--color-surface-3)] mx-8 mb-1" />

      <IdeaResources ideaId={ideaId} />

      <div
        data-piece-feed-scroll
        className="flex-1 overflow-y-auto snap-y snap-mandatory"
        onScroll={handleFeedScroll}
      >
        {visible.length === 0 ? (
          <ShortformEmptyState filter={filter} />
        ) : (
          <ShortformFeed
            rootIdeaId={ideaId}
            pieces={visible}
            ideas={ideas}
            now={now}
            focusedIndex={focusedIndex}
            editing={mode === "editing"}
            onFocusCard={(index) => setFocusedIndex(index)}
            onEnterEdit={() => setMode("editing")}
            onExitEdit={handleExitEdit}
            onDelete={handleDelete}
          />
        )}
      </div>
    </div>
  );
}
