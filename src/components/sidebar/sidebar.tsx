"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Search,
  HelpCircle,
  CalendarDays,
  ScrollText,
  Cloud,
  CloudOff,
  Check,
  X,
  Lightbulb,
  ChevronRight,
  ChevronDown,
  Pin,
  Flag,
  MoreHorizontal,
  Monitor,
  MessageSquare,
  Inbox,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import {
  archivedIdeas,
  draftsForIdea,
  pieceCountsForIdea,
  publishRollupForIdea,
  shortformOnly,
} from "@/stores/content-selectors";
import { formatDate } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  useContextMenu,
} from "@/components/common/context-menu";
import { priorityMeta } from "@/lib/priority";
import { PriorityFlagPicker } from "@/components/shortform/piece-priority-picker";
import { useToastStore } from "@/hooks/use-toast";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import { hasAnyWorkingProvider } from "@/lib/ai/connection-status";
import { isTauri } from "@/lib/ai-client";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { FeedbackPanel, FeedbackRecordingBar } from "@/components/feedback/feedback-panel";
import { useMediaCapture } from "@/components/feedback/use-media-capture";
import type { Idea, Priority } from "@/lib/content-engine";

interface SidebarProps {
  onOpenSettings: () => void;
  /** Render the collapsed strip instead of the full column. */
  rail?: boolean;
  /** True when this is the panel hovering open over the rail rather than the
   * pinned column. The only difference is the header button: peeked, the
   * useful move is to keep it open; pinned, it is to put it away. */
  peeking?: boolean;
  onOpenAccount: () => void;
  onOpenAI: () => void;
  onOpenHelp: () => void;
  onOpenCalendar: () => void;
  onOpenLogs: () => void;
}

type IdeaSortMode = "pinned" | "priority" | "created";

const IDEA_SORT_LABELS: Record<IdeaSortMode, string> = {
  pinned: "Pinned + last touched",
  priority: "Priority",
  created: "Created",
};

function priorityRank(priority: Priority): number {
  return priority === 0 ? 5 : priority;
}

/**
 * Orders ideas for the sidebar. Pinned ideas always float to the top
 * (most-recently-pinned first) regardless of mode — the chosen mode only
 * governs the ordering of everything else.
 */
function sortIdeas(ideas: Idea[], mode: IdeaSortMode): Idea[] {
  const pinned = ideas
    .filter((i) => i.pinnedAt !== undefined)
    .sort((a, b) => (b.pinnedAt as number) - (a.pinnedAt as number));
  const rest = ideas.filter((i) => i.pinnedAt === undefined);
  const sortedRest = [...rest].sort((a, b) => {
    if (mode === "priority") {
      const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
      if (rankDiff !== 0) return rankDiff;
      return b.updatedAt - a.updatedAt;
    }
    if (mode === "created") return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt; // pinned + last-touched (default)
  });
  return [...pinned, ...sortedRest];
}

/**
 * Does this idea answer the search? Its own words first, then the words of the
 * fragments inside it: the sidebar is the only list left, so a search that read
 * titles alone would have no way of finding the sentence you remember writing.
 * `fragmentText` is the pre-lowercased body of everything the idea holds, built
 * once per keystroke rather than per row (see fragmentTextByIdea).
 */
function ideaMatches(idea: Idea, query: string, fragmentText: string): boolean {
  const q = query.toLowerCase();
  return (
    idea.title.toLowerCase().includes(q) ||
    (idea.summary ?? "").toLowerCase().includes(q) ||
    fragmentText.includes(q)
  );
}

export function Sidebar({ onOpenSettings, onOpenAccount, onOpenAI, onOpenHelp, onOpenCalendar, onOpenLogs, rail, peeking }: SidebarProps) {
  const { toggleSidebar } = useAppStore();
  const pinSidebar = useAppStore((s) => s.pinSidebar);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const setActivePiece = useAppStore((s) => s.setActivePiece);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const openInboxReview = useAppStore((s) => s.openInboxReview);
  const isFeedbackOpen = useAppStore((s) => s.isFeedbackOpen);
  const openFeedback = useAppStore((s) => s.openFeedback);
  const toggleCommentsPanel = useAppStore((s) => s.toggleCommentsPanel);
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);
  const createIdea = useContentStore((s) => s.createIdea);
  const createIdeaWithFragment = useContentStore((s) => s.createIdeaWithFragment);
  const createPiece = useContentStore((s) => s.createPiece);
  const updateIdea = useContentStore((s) => s.updateIdea);
  const reparentIdea = useContentStore((s) => s.reparentIdea);
  const setIdeaPriority = useContentStore((s) => s.setIdeaPriority);
  const pinIdea = useContentStore((s) => s.pinIdea);
  const unpinIdea = useContentStore((s) => s.unpinIdea);
  const deleteIdeaCascade = useContentStore((s) => s.deleteIdeaCascade);
  const restoreIdeaCascade = useContentStore((s) => s.restoreIdeaCascade);
  const archiveIdeaCascade = useContentStore((s) => s.archiveIdeaCascade);
  const restoreIdeaArchive = useContentStore((s) => s.restoreIdeaArchive);
  const showToast = useToastStore((s) => s.showToast);
  const settings = useSettingsStore((s) => s.settings);
  const badProviders = useAppStore((s) => s.badProviders);
  const syncStatus = useSyncStore((s) => s.snapshot.status);
  // "syncing" counts as synced: edits trigger a debounced sync pass every few
  // seconds while writing, and rendering that as "Not synced" makes the badge
  // flicker. Only a real problem (signed out, offline, error) breaks the state.
  const isSynced = syncStatus === "idle" || syncStatus === "syncing";
  const aiConnected = hasAnyWorkingProvider(settings, badProviders);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [ideaSort, setIdeaSort] = useState<IdeaSortMode>("pinned");
  // Sub-ideas start collapsed. The sidebar is a list of ideas to move
  // between; what's *inside* one is the idea workspace panel's job, so the
  // default here is the shortest list that still shows every idea you have.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // The row (or rows) the open menu is acting on, and where it opened. One
  // menu for the whole sidebar rather than one per row: it is portaled out to
  // the window now, so there is nothing to gain from building it inside the
  // row it belongs to and everything to lose to the sidebar's own clipping.
  const [menuIdeaId, setMenuIdeaId] = useState<string | null>(null);
  const { point: menuPoint, openAt: openMenuAt, close: closeMenuPoint } = useContextMenu();
  // Ideas ticked for a bulk action, and the row a shift-click measures from.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Media capture state is shared so the compact bar can control it
  const media = useMediaCapture();
  const [feedbackMinimized, setFeedbackMinimized] = useState(false);

  // Auto-minimize when recording starts, auto-expand when recording stops
  const isActivelyRecording = media.isRecording;
  const showCompactBar = isFeedbackOpen && feedbackMinimized && isActivelyRecording;
  const showFullFeedback = isFeedbackOpen && !showCompactBar;

  const allPieces = useMemo(() => Object.values(pieces), [pieces]);
  // Counts on an idea row mean short-form pieces. Its long-form drafts are
  // listed by name underneath instead, so counting them here would double up.
  const shortPieces = useMemo(() => shortformOnly(allPieces), [allPieces]);
  // The live library. Archived ideas are still in the store and still hold
  // every word they held, they just stop competing for attention in the list
  // you navigate by.
  const allIdeas = useMemo(
    () => Object.values(ideas).filter((i) => !i.deletedAt && i.archivedAt === undefined),
    [ideas],
  );
  const liveIdeaIds = useMemo(() => new Set(allIdeas.map((idea) => idea.id)), [allIdeas]);
  const inboxPieces = useMemo(
    () =>
      allPieces
        .filter(
          (piece) =>
            piece.status === "inbox" &&
            piece.reviewQueue === undefined &&
            piece.deletedAt === undefined &&
            piece.archivedAt === undefined &&
            liveIdeaIds.has(piece.ideaId),
        )
        .sort((a, b) => a.createdAt - b.createdAt),
    [allPieces, liveIdeaIds],
  );
  // Only the top of each archived tree gets a row: a sub-idea archived along
  // with its parent is already accounted for by the parent's line, and listing
  // both would make one gesture look like two.
  const archived = useMemo(() => {
    const all = archivedIdeas(Object.values(ideas));
    const archivedIds = new Set(all.map((i) => i.id));
    return all.filter((i) => !i.parentId || !archivedIds.has(i.parentId));
  }, [ideas]);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const childrenByParent = useMemo(() => {
    const map = new Map<string, Idea[]>();
    for (const idea of allIdeas) {
      if (!idea.parentId) continue;
      const list = map.get(idea.parentId) ?? [];
      list.push(idea);
      map.set(idea.parentId, list);
    }
    return map;
  }, [allIdeas]);

  const rootIdeas = useMemo(() => allIdeas.filter((i) => !i.parentId), [allIdeas]);

  /** Every idea's fragments as one lowercased haystack, so searching the text
   * of what you wrote costs one pass over the library instead of one per row. */
  const fragmentTextByIdea = useMemo(() => {
    const map = new Map<string, string>();
    for (const piece of allPieces) {
      if (piece.deletedAt !== undefined) continue;
      const text = `${piece.title ?? ""}\n${piece.body}`.toLowerCase();
      const existing = map.get(piece.ideaId);
      map.set(piece.ideaId, existing ? `${existing}\n${text}` : text);
    }
    return map;
  }, [allPieces]);

  const matches = useCallback(
    (idea: Idea, query: string) => ideaMatches(idea, query, fragmentTextByIdea.get(idea.id) ?? ""),
    [fragmentTextByIdea],
  );

  const visibleRoots = useMemo(() => {
    const q = searchQuery.trim();
    let roots = rootIdeas;
    if (q) {
      roots = roots.filter(
        (r) => matches(r, q) || (childrenByParent.get(r.id) ?? []).some((c) => matches(c, q)),
      );
    }
    return sortIdeas(roots, ideaSort);
  }, [rootIdeas, childrenByParent, searchQuery, ideaSort, matches]);

  const childrenFor = useCallback(
    (idea: Idea): Idea[] => {
      const kids = childrenByParent.get(idea.id) ?? [];
      const q = searchQuery.trim();
      const filtered = q && !matches(idea, q) ? kids.filter((c) => matches(c, q)) : kids;
      return sortIdeas(filtered, ideaSort);
    },
    [childrenByParent, searchQuery, matches, ideaSort],
  );

  /** Is this root's sub-idea list showing? Auto-expanded when a child is the
   * open idea, or when a search is on — hiding the row you just matched would
   * be a bug, not tidiness. */
  const isRowExpanded = useCallback(
    (idea: Idea, kids: Idea[]) =>
      expanded.has(idea.id) ||
      searchQuery.trim() !== "" ||
      kids.some((k) => k.id === activeIdeaId),
    [expanded, searchQuery, activeIdeaId],
  );

  /** Every idea row on screen, top to bottom. Shift-click selects a range,
   * and a range only means anything against the order actually rendered. */
  const visibleOrder = useMemo(() => {
    const order: string[] = [];
    for (const root of visibleRoots) {
      order.push(root.id);
      const kids = childrenFor(root);
      if (kids.length > 0 && isRowExpanded(root, kids)) {
        for (const kid of kids) order.push(kid.id);
      }
    }
    return order;
  }, [visibleRoots, childrenFor, isRowExpanded]);

  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);

  function openSearch() {
    setSearchOpen(true);
    // Focus once the expand has begun; the input exists from the first frame.
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  /** Closing also clears the query: a hidden filter on the list would look
   * like data loss ("where did my ideas go?"), not like a remembered search. */
  function closeSearch() {
    setSearchOpen(false);
    setSearchQuery("");
  }

  /** New idea, with the first fragment to write in already inside it. Every
   * fragment belongs to an idea, so "start something new" is one action, not a
   * container you then have to remember to fill. */
  function handleNewIdea() {
    const { ideaId, pieceId } = createIdeaWithFragment();
    if (!ideaId) return;
    setActiveIdea(ideaId);
    setActivePiece(pieceId || null);
    setShowCreationFlow(true);
    // Straight into rename: an untitled idea is worthless as a container, and
    // naming it is the whole point of creating one. The box opens empty rather
    // than pre-filled, so the first keystroke is the name.
    startRename(ideaId, "");
  }

  /** Select an idea, and with it a draft to write in: the one asked for, else
   * the idea's first draft, else nothing (the editor then offers to start one). */
  function handleSelectIdea(ideaId: string, pieceId?: string) {
    setActiveIdea(ideaId);
    if (pieceId) {
      setActivePiece(pieceId);
      return;
    }
    const drafts = draftsForIdea(ideaId, allPieces);
    setActivePiece(drafts[0]?.id ?? null);
  }

  function handleOpenInbox() {
    const first = inboxPieces[0];
    if (first) openInboxReview(first.ideaId, true);
  }

  /** Start a fresh long-form fragment inside an idea. */
  function handleNewDraft(ideaId: string) {
    const pieceId = createPiece({
      ideaId,
      format: "essay",
      origin: "user",
      status: "in-progress",
      seen: true,
    });
    if (!pieceId) return;
    setActiveIdea(ideaId);
    setActivePiece(pieceId);
    setShowCreationFlow(true);
    setExpanded((prev) => new Set(prev).add(ideaId));
  }

  function handleDeleteIdea(idea: Idea) {
    const cascade = deleteIdeaCascade(idea.id);
    if (!cascade.ideaIds.length) return;
    if (cascade.ideaIds.includes(activeIdeaId ?? "")) {
      setActiveIdea(null);
      setActivePiece(null);
    }
    showToast(`Deleted "${idea.title || "Untitled idea"}"`, {
      label: "Undo",
      onClick: () => restoreIdeaCascade(cascade),
    });
  }

  function handleArchiveIdea(idea: Idea) {
    const archive = archiveIdeaCascade(idea.id);
    if (!archive.ideaIds.length && !archive.pieceIds.length) return;
    // Same courtesy the delete path shows: an idea you are standing inside
    // should not vanish underneath you without the app letting go of it first.
    if (archive.ideaIds.includes(activeIdeaId ?? "")) {
      setActiveIdea(null);
      setActivePiece(null);
    }
    showToast(`Archived "${idea.title || "Untitled idea"}"`, {
      label: "Undo",
      onClick: () => restoreIdeaArchive(archive),
    });
  }

  /**
   * Undo an archive long after the toast is gone. Rebuilt from the stamp
   * rather than remembered: everything one cascade put away shares a single
   * archivedAt, so matching on it restores exactly that gesture and leaves
   * alone any child or piece the writer archived separately, whose stamp is
   * its own.
   */
  function handleRestoreIdea(idea: Idea) {
    const ideaIds = [
      idea.id,
      ...Object.values(ideas)
        .filter((i) => i.parentId === idea.id && i.archivedAt === idea.archivedAt)
        .map((i) => i.id),
    ];
    const owned = new Set(ideaIds);
    restoreIdeaArchive({
      ideaIds,
      pieceIds: Object.values(pieces)
        .filter((p) => owned.has(p.ideaId) && p.archivedAt === idea.archivedAt)
        .map((p) => p.id),
    });
    showToast(`"${idea.title || "Untitled idea"}" is back`);
  }

  // ---------------------------------------------------------------------
  // Selecting several ideas at once.
  //
  // Ticking rows is not a mode you turn on: ⌘-click (or the checkbox that
  // appears on hover) starts a selection, shift-click extends it, and a plain
  // click anywhere puts it away and goes back to opening ideas. The bulk bar
  // only exists while something is ticked, so the sidebar you use every day is
  // the sidebar you already know.
  // ---------------------------------------------------------------------

  const selectionCount = selectedIds.size;

  /** The ticked ideas, as rows that still exist and are still in the list.
   * Filtered rather than trusted: an idea can be archived or deleted from
   * another surface while it sits ticked here. */
  const selectedIdeas = useMemo(() => {
    const live: Idea[] = [];
    for (const id of selectedIds) {
      const idea = ideas[id];
      if (idea && idea.deletedAt === undefined && idea.archivedAt === undefined) live.push(idea);
    }
    return live;
  }, [selectedIds, ideas]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setAnchorId(null);
  }, []);

  function toggleSelected(ideaId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(ideaId)) next.delete(ideaId);
      else next.add(ideaId);
      return next;
    });
    setAnchorId(ideaId);
  }

  /** Everything between the last-clicked row and this one, in screen order. */
  function selectRangeTo(ideaId: string) {
    const from = anchorId ? visibleOrder.indexOf(anchorId) : -1;
    const to = visibleOrder.indexOf(ideaId);
    if (from === -1 || to === -1) {
      toggleSelected(ideaId);
      return;
    }
    const [lo, hi] = from <= to ? [from, to] : [to, from];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (let i = lo; i <= hi; i += 1) next.add(visibleOrder[i]);
      return next;
    });
  }

  /**
   * What a click on a row means, in one place.
   *
   * Plain click still just opens the idea, and drops any selection on the way:
   * a set of ticks left behind after you have moved on is a loaded gun the
   * next Delete finds.
   */
  function handleRowClick(idea: Idea, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      toggleSelected(idea.id);
      return;
    }
    if (e.shiftKey && anchorId) {
      selectRangeTo(idea.id);
      return;
    }
    if (selectionCount > 0) clearSelection();
    handleSelectIdea(idea.id);
  }

  // Escape puts a selection away, the same key that closes everything else
  // here. Without it the only exit is clicking a row, which also navigates.
  //
  // Not while a menu is open, though: that Escape is aimed at the menu, and
  // both listeners sit on the window, so without this the one press would
  // close the menu and throw away the selection it was about to act on.
  useEffect(() => {
    if (selectionCount === 0 || menuPoint) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") clearSelection();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionCount, menuPoint, clearSelection]);

  /** Rows the open menu is acting on: the whole ticked set when the menu was
   * opened on one of them, otherwise just the row it was opened on. */
  const menuTargets = useMemo(() => {
    if (!menuIdeaId) return [];
    if (selectedIds.has(menuIdeaId) && selectedIdeas.length > 1) return selectedIdeas;
    const idea = ideas[menuIdeaId];
    return idea ? [idea] : [];
  }, [menuIdeaId, selectedIds, selectedIdeas, ideas]);

  const isBulkMenu = menuTargets.length > 1;
  const allTargetsPinned = menuTargets.length > 0 && menuTargets.every((i) => i.pinnedAt !== undefined);

  function openMenuFor(ideaId: string, e: React.MouseEvent) {
    setMenuIdeaId(ideaId);
    openMenuAt(e);
  }

  function closeMenu() {
    closeMenuPoint();
    setMenuIdeaId(null);
  }

  // --- the bulk actions themselves ---

  function bulkSetPinned(targets: Idea[], pinned: boolean) {
    for (const idea of targets) {
      if (pinned) pinIdea(idea.id);
      else unpinIdea(idea.id);
    }
    showToast(`${targets.length} ${targets.length === 1 ? "idea" : "ideas"} ${pinned ? "pinned" : "unpinned"}`);
  }

  function bulkSetPriority(targets: Idea[], priority: Priority) {
    for (const idea of targets) setIdeaPriority(idea.id, priority);
    const label = priorityMeta(priority)?.label ?? "None";
    showToast(`Priority set to ${label} on ${targets.length} ${targets.length === 1 ? "idea" : "ideas"}`);
  }

  /** Archive or delete a whole selection as one gesture, with one undo that
   * puts all of it back. Each idea still goes through its own cascade, so
   * sub-ideas and pieces travel with their parent exactly as they do singly. */
  function bulkArchive(targets: Idea[]) {
    const ideaIds: string[] = [];
    const pieceIds: string[] = [];
    for (const idea of targets) {
      const archive = archiveIdeaCascade(idea.id);
      ideaIds.push(...archive.ideaIds);
      pieceIds.push(...archive.pieceIds);
    }
    if (!ideaIds.length && !pieceIds.length) return;
    if (ideaIds.includes(activeIdeaId ?? "")) {
      setActiveIdea(null);
      setActivePiece(null);
    }
    clearSelection();
    showToast(`Archived ${targets.length} ${targets.length === 1 ? "idea" : "ideas"}`, {
      label: "Undo",
      onClick: () => restoreIdeaArchive({ ideaIds, pieceIds }),
    });
  }

  function bulkDelete(targets: Idea[]) {
    const ideaIds: string[] = [];
    const pieceIds: string[] = [];
    for (const idea of targets) {
      const cascade = deleteIdeaCascade(idea.id);
      ideaIds.push(...cascade.ideaIds);
      pieceIds.push(...cascade.pieceIds);
    }
    if (!ideaIds.length) return;
    if (ideaIds.includes(activeIdeaId ?? "")) {
      setActiveIdea(null);
      setActivePiece(null);
    }
    clearSelection();
    showToast(`Deleted ${targets.length} ${targets.length === 1 ? "idea" : "ideas"}`, {
      label: "Undo",
      onClick: () => restoreIdeaCascade({ ideaIds, pieceIds }),
    });
  }

  /**
   * Group a selection under a new idea.
   *
   * Fragment has no folders and no tags: an idea holding sub-ideas IS the
   * grouping, so grouping means making a new parent and moving the selection
   * under it. Ideas nest exactly one level (see assertIdeaParentAllowed), so
   * an idea that already has sub-ideas of its own cannot become one — those
   * are left where they are and the toast says how many, rather than the
   * gesture half-working in silence.
   */
  function bulkGroup(targets: Idea[]) {
    const movable = targets.filter((idea) => (childrenByParent.get(idea.id) ?? []).length === 0);
    if (movable.length === 0) {
      showToast("Those ideas already have sub-ideas. Ideas nest one level deep");
      return;
    }
    const parentId = createIdea({ title: "Untitled idea" });
    if (!parentId) return;
    const previous = movable
      .filter((idea) => reparentIdea(idea.id, parentId))
      .map((idea) => ({ id: idea.id, parentId: idea.parentId }));
    if (previous.length === 0) {
      deleteIdeaCascade(parentId);
      showToast("Nothing could be grouped. Ideas nest one level deep");
      return;
    }
    const skipped = targets.length - previous.length;
    clearSelection();
    setExpanded((prev) => new Set(prev).add(parentId));
    handleSelectIdea(parentId);
    // Straight into rename, the way a new idea is: a group nobody names is a
    // row called "Untitled idea" holding everything you just tidied.
    startRename(parentId, "");
    showToast(
      `Grouped ${previous.length} ${previous.length === 1 ? "idea" : "ideas"}${skipped > 0 ? `. ${skipped} left alone, already has sub-ideas` : ""}`,
      {
        label: "Undo",
        onClick: () => {
          // Put each one back where it was first, so the group idea is empty
          // by the time it is deleted and the cascade takes nothing with it.
          for (const row of previous) reparentIdea(row.id, row.parentId);
          deleteIdeaCascade(parentId);
        },
      },
    );
  }

  function startRename(ideaId: string, currentTitle: string) {
    closeMenu();
    setRenamingId(ideaId);
    setRenameValue(currentTitle);
  }

  function commitRename() {
    if (!renamingId) return;
    const title = renameValue.trim();
    if (title) updateIdea(renamingId, { title });
    setRenamingId(null);
  }

  function toggleExpanded(ideaId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ideaId)) next.delete(ideaId);
      else next.add(ideaId);
      return next;
    });
  }

  function renderIdeaRow(idea: Idea, depth: 0 | 1) {
    const isActive = idea.id === activeIdeaId;
    const isPinned = idea.pinnedAt !== undefined;
    // The sidebar has always *sorted* by priority and never shown it, so a
    // list ordered by something invisible looked arbitrary.
    const ideaPriority = priorityMeta(idea.priority);
    const kids = depth === 0 ? childrenFor(idea) : [];
    const drafts = draftsForIdea(idea.id, allPieces);
    const hasChildren = kids.length > 0;
    const isExpanded = isRowExpanded(idea, kids);
    const counts = pieceCountsForIdea(idea.id, shortPieces);
    const inboxCount = allPieces.filter(
      (piece) =>
        piece.ideaId === idea.id &&
        piece.status === "inbox" &&
        piece.reviewQueue === undefined &&
        piece.deletedAt === undefined &&
        piece.archivedAt === undefined,
    ).length;
    const extractedCount = shortPieces.filter(
      (piece) =>
        piece.ideaId === idea.id &&
        piece.reviewQueue === "extraction" &&
        piece.deletedAt === undefined &&
        piece.archivedAt === undefined,
    ).length;
    const total = counts["in-progress"] + counts.ready + counts.published;
    // Across every format, unlike `counts` above: a shipped long-form draft is
    // the main thing "did anything come of this idea?" is asking about.
    const shipped = publishRollupForIdea(idea.id, allPieces);
    const shippedSummary = shipped.count > 0 ? ` · ${shipped.count} published` : "";
    const summaryLine = `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} · ${total} ${total === 1 ? "piece" : "pieces"}${extractedCount > 0 ? ` · ${extractedCount} extracted` : ""}${inboxCount > 0 ? ` · ${inboxCount} in inbox` : ""}${shippedSummary}`;
    const hasUnseenAgent = allPieces.some(
      (p) => p.ideaId === idea.id && p.deletedAt === undefined && !p.seen && p.origin === "agent",
    );
    const isRenaming = renamingId === idea.id;
    const isSelected = selectedIds.has(idea.id);

    return (
      <div key={idea.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => handleRowClick(idea, e)}
          // Shift-clicking a row would otherwise drag-select the sidebar's
          // text, which is never what extending a selection means.
          onMouseDown={(e) => { if (e.shiftKey) e.preventDefault(); }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelectIdea(idea.id); }}
          onDoubleClick={() => startRename(idea.id, idea.title)}
          // Right-clicking a row that is part of a selection acts on the whole
          // selection; right-clicking any other row acts on that row alone,
          // and leaves the selection where it is.
          onContextMenu={(e) => openMenuFor(idea.id, e)}
          title={summaryLine}
          className={`group relative flex flex-col w-full text-left px-3 py-2 rounded-[var(--radius-lg)] transition-all duration-150 cursor-pointer
            ${isSelected
              ? "bg-gold/10 border border-gold/30"
              : isActive
                ? "bg-surface-3 border border-border-strong"
                : "border border-transparent hover:bg-surface-2"}`}
        >
          {isActive && (
            <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gold" />
          )}
          <div className="flex items-center gap-2">
            {/* The tick box. Hidden until you hover the row or a selection is
                already running, so the everyday sidebar keeps its shape and
                the feature is one hover away rather than permanently in the
                way of a 300px column. */}
            <button
              onClick={(e) => { e.stopPropagation(); toggleSelected(idea.id); }}
              role="checkbox"
              aria-checked={isSelected}
              aria-label={isSelected ? `Deselect ${idea.title || "Untitled idea"}` : `Select ${idea.title || "Untitled idea"}`}
              title="Select. ⌘-click rows to add, shift-click for a range"
              className={`shrink-0 grid place-items-center w-3.5 h-3.5 rounded-[3px] border transition-all duration-150
                ${isSelected
                  ? "bg-gold border-gold text-surface opacity-100"
                  : `border-border-strong text-transparent hover:border-gold ${selectionCount > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}`}
            >
              <Check size={9} strokeWidth={3} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); if (hasChildren) toggleExpanded(idea.id); }}
              title={hasChildren ? `${kids.length} sub-${kids.length === 1 ? "idea" : "ideas"}` : undefined}
              className={`shrink-0 p-0.5 rounded text-text-faint ${hasChildren ? "hover:text-text-secondary" : "opacity-0 pointer-events-none"}`}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            {isPinned && <Pin size={10} className="shrink-0 text-gold" fill="currentColor" />}
            {ideaPriority && (
              <span title={`${ideaPriority.label} priority`} className={`shrink-0 ${ideaPriority.className}`}>
                <Flag size={9} fill="currentColor" />
              </span>
            )}
            {isRenaming ? (
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") setRenamingId(null);
                }}
                placeholder="Name this idea…"
                className="flex-1 min-w-0 bg-surface-2 border border-border-active rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[13px] text-text-primary outline-none"
              />
            ) : (
              <span className={`flex-1 min-w-0 truncate text-[13px] font-medium ${isActive ? "text-text-primary" : "text-text-secondary"}`}>
                {idea.title || "Untitled idea"}
              </span>
            )}
            {inboxCount > 0 && (
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  openInboxReview(idea.id);
                }}
                title={`${inboxCount} piece${inboxCount === 1 ? "" : "s"} waiting in this idea's inbox`}
                className="shrink-0 px-1.5 rounded-full text-[10px] font-[family-name:var(--font-mono)] text-gold bg-gold/10 border border-gold/20 hover:bg-gold/20 transition-colors duration-150"
              >
                {inboxCount}
              </button>
            )}
            {/* This idea shipped something. The count was already being
                computed here and thrown away, so an idea gave no sign of having
                produced published work. */}
            {shipped.count > 0 && (
              <span
                title={
                  shipped.latestAt !== null
                    ? `${shipped.count} published · last on ${new Date(shipped.latestAt).toLocaleDateString()}`
                    : `${shipped.count} published`
                }
                className="shrink-0 flex items-center gap-1 text-[10px] font-[family-name:var(--font-mono)] text-green"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-green" />
                {shipped.latestAt !== null && formatDate(shipped.latestAt)}
              </span>
            )}
            {hasUnseenAgent && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-gold shrink-0"
                style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
              />
            )}
            <button
              onClick={(e) => { e.stopPropagation(); openMenuFor(idea.id, e); }}
              title="Rename, add a draft, delete…"
              // Always visible, unlike the hover-revealed actions elsewhere in
              // this sidebar: this menu is the only route to renaming and
              // deleting an idea, so hiding it hides the feature.
              className="shrink-0 p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-all duration-150"
            >
              <MoreHorizontal size={12} />
            </button>
          </div>
          {/* The counts live in the row's tooltip, not on a second line: with
              a dozen ideas the list has to stay scannable, and what's inside
              an idea is spelled out in the workspace panel anyway. */}
        </div>

        {/* Sub-ideas only. What's *inside* an idea — its drafts and pieces —
            lives in the idea workspace panel that opens beside this sidebar
            when the idea is selected (see components/idea/idea-panel.tsx). */}
        {hasChildren && isExpanded && (
          <div className="ml-4 pl-3 border-l border-border space-y-1 mt-1">
            {kids.map((child) => renderIdeaRow(child, 1))}
          </div>
        )}
      </div>
    );
  }

  // The collapsed strip. Deliberately inert: hovering it grows the panel over
  // the top of it, so a button here would be covered before anyone could
  // finish reaching for it. What the strip is for is showing that the library
  // is still there and what it holds — ideas, new idea, search, settings — and
  // holding the column's width so the editor never shifts when the panel
  // peeks. Every one of these icons is a real control one hover away.
  if (rail) {
    return (
      <div
        data-sidebar
        aria-hidden
        title="Your ideas. Hover to open"
        className="flex flex-col items-center h-full w-full py-5 gap-4 bg-surface rounded-[var(--radius-xl)] text-text-faint"
      >
        <PanelLeftOpen size={16} />
        <div className="w-5 border-t border-border" />
        <Lightbulb size={16} />
        <Inbox size={16} />
        <Search size={16} />
        <div className="flex-1" />
        <Settings size={16} />
      </div>
    );
  }

  return (
    <div data-sidebar className="flex flex-col h-full w-[300px] bg-surface rounded-[var(--radius-xl)] overflow-hidden">
      {showFullFeedback ? (
        <FeedbackPanel />
      ) : (
        <>
          {/* Header */}
          <div className="flex items-center justify-between px-7 pt-6 pb-4 shrink-0">
            <span className="font-[family-name:var(--font-display)] text-lg text-text-primary tracking-tight">
              Fragment
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={onOpenAccount}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-default)] transition-all duration-300 ${
                  isSynced ? "text-green" : "text-text-faint"
                }`}
                title={isSynced ? "Synced with cloud" : "Not synced with cloud"}
              >
                {isSynced ? <Cloud size={12} /> : <CloudOff size={12} />}
                <span className="text-[10px] font-[family-name:var(--font-mono)] font-medium">
                  {isSynced ? "Synced" : "Not synced"}
                </span>
              </button>
              <button
                onClick={onOpenAI}
                className={`flex items-center gap-1 px-2 py-1 rounded-[var(--radius-default)] transition-all duration-300 ${
                  aiConnected ? "text-green" : "text-red"
                }`}
                title={aiConnected ? "AI provider configured" : "No AI provider connected"}
              >
                <span className="text-[10px] font-[family-name:var(--font-mono)] font-medium">AI</span>
                {aiConnected ? <Check size={12} /> : <X size={12} />}
              </button>
              {/* Peeked, this is the only control that can pin the panel: the
                  rail underneath is covered the moment you hover it. */}
              <button
                onClick={peeking ? pinSidebar : toggleSidebar}
                title={peeking ? "Keep sidebar open" : "Collapse sidebar"}
                aria-label={peeking ? "Keep sidebar open" : "Collapse sidebar"}
                className="p-2 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
              >
                {peeking ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </button>
            </div>
          </div>

          {/* New idea + search, one row. The search is a square button until
              clicked; open, it grows to fill the row and the create button
              collapses to zero width under it. Every state change is
              width/flex/margin only, so the whole swap is one smooth slide.
              One create button, not two: an idea and the fragment you write in
              are made together now, so there is nothing else to start. */}
          <div className="px-5 pb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={handleNewIdea}
                tabIndex={searchOpen ? -1 : 0}
                title="New idea: a home for its drafts and its short-form pieces"
                className={`flex items-center gap-3 py-3 rounded-[var(--radius-lg)] text-[13px] font-medium
                  bg-surface-2 text-text-secondary border
                  hover:bg-surface-3 hover:text-text-primary hover:border-gold/20
                  transition-all duration-300 overflow-hidden whitespace-nowrap min-w-0
                  ${searchOpen
                    ? "flex-[0_1_0%] px-0 opacity-0 border-transparent pointer-events-none"
                    : "flex-[1_1_0%] px-4 border-border-strong"}`}
              >
                <Lightbulb size={15} strokeWidth={2} className="shrink-0" />
                New idea
              </button>
              <div
                role={searchOpen ? undefined : "button"}
                tabIndex={searchOpen ? undefined : 0}
                onClick={searchOpen ? undefined : openSearch}
                onKeyDown={searchOpen ? undefined : (e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSearch(); }
                }}
                title={searchOpen ? undefined : "Search ideas and pieces"}
                className={`flex items-center h-11 rounded-[var(--radius-lg)] bg-surface-2 border overflow-hidden
                  transition-all duration-300
                  ${searchOpen
                    ? "flex-[1_1_0%] -ml-2 gap-3 px-4 border-border-strong text-text-muted"
                    : "w-11 shrink-0 justify-center border-border-strong text-text-secondary hover:bg-surface-3 hover:text-text-primary hover:border-gold/20 cursor-pointer"}`}
              >
                <Search size={14} className="shrink-0" />
                {searchOpen && (
                  <>
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Escape") closeSearch(); }}
                      placeholder="Search ideas and pieces..."
                      className="flex-1 min-w-0 bg-transparent text-[13px] text-text-secondary placeholder:text-text-faint outline-none"
                    />
                    <button
                      onClick={closeSearch}
                      title="Close search"
                      className="shrink-0 p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary transition-colors duration-150"
                    >
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="px-5 pb-3">
            <button
              onClick={handleOpenInbox}
              disabled={inboxPieces.length === 0}
              title={
                inboxPieces.length > 0
                  ? `Review ${inboxPieces.length} external piece${inboxPieces.length === 1 ? "" : "s"}`
                  : "No external pieces are waiting"
              }
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-lg)] border text-[12px] font-medium transition-all duration-150 ${
                inboxPieces.length > 0
                  ? "border-gold/25 bg-gold/5 text-text-secondary hover:bg-gold/10 hover:text-text-primary"
                  : "border-border text-text-faint opacity-60 cursor-default"
              }`}
            >
              <Inbox size={14} className={inboxPieces.length > 0 ? "text-gold" : ""} />
              <span>Inbox</span>
              <span className="ml-auto font-[family-name:var(--font-mono)] text-[11px]">
                {inboxPieces.length}
              </span>
            </button>
          </div>

          {/* The bulk bar. Only here while something is ticked, and outside
              the scroller on purpose: the actions for a selection must not
              scroll away from the rows they act on. */}
          {selectionCount > 0 && (
            <div className="mx-5 mb-2 shrink-0 flex items-center gap-2 rounded-[var(--radius-lg)] border border-gold/30 bg-gold/10 px-3 py-2">
              <span
                className="text-[11px] font-medium text-text-primary"
                title="⌘-click rows to tick more than one, or shift-click for a run of them. Actions works on all of them at once, with a single Undo. Esc clears the ticks."
              >
                {selectionCount} selected
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuIdeaId(anchorId ?? selectedIdeas[0]?.id ?? null);
                  openMenuAt(e);
                }}
                className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] border border-border-strong bg-surface-2 px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors duration-150"
              >
                Actions
                <ChevronDown size={10} />
              </button>
              <button
                onClick={clearSelection}
                title="Clear selection (Esc)"
                className="shrink-0 p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-colors duration-150"
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* Idea list. Every fragment lives inside one, so this is the whole
              library: there is no second list of homeless documents. */}
          <div className="flex-1 overflow-y-auto px-5 py-2">
            {/* Ideas section */}
            <div className="flex items-center justify-between px-1 mb-1.5">
              <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
                Ideas
              </span>
              {allIdeas.length > 0 && (
                <select
                  value={ideaSort}
                  onChange={(e) => setIdeaSort(e.target.value as IdeaSortMode)}
                  title="Sort ideas"
                  className="bg-transparent text-[10px] text-text-faint outline-none cursor-pointer"
                >
                  {(Object.keys(IDEA_SORT_LABELS) as IdeaSortMode[]).map((mode) => (
                    <option key={mode} value={mode}>{IDEA_SORT_LABELS[mode]}</option>
                  ))}
                </select>
              )}
            </div>

            {visibleRoots.length === 0 ? (
              <p className="px-1 pb-3 text-[12px] text-text-faint leading-relaxed">
                {searchQuery.trim()
                  ? "No matching ideas"
                  : "No ideas yet. An idea is a folder for one thing you're writing about: it holds your long-form drafts and a feed of short-form pieces. Hit New idea above to make one."}
              </p>
            ) : (
              <>
                <p className="px-1 pb-2 text-[11px] text-text-faint leading-relaxed">
                  Open an idea to work inside it: its drafts and pieces appear in the panel
                  beside this one. Right-click or use ⋯ to rename, add, or delete.
                  ⌘-click rows to pick several at once.
                </p>
                <div className="space-y-1 mb-4">
                  {visibleRoots.map((idea) => renderIdeaRow(idea, 0))}
                </div>
              </>
            )}

            {/* The archive. Collapsed by default and absent entirely when
                empty: the whole point of putting something away is that it
                stops taking up room, and a permanent "Archived 0" header
                would give the tidying back with one hand. */}
            {archived.length > 0 && (
              <div className="mt-2 border-t border-border pt-2">
                <button
                  onClick={() => setArchiveOpen((v) => !v)}
                  title="Ideas you put away. Everything they hold is still here"
                  className="flex items-center gap-1.5 w-full px-1 py-1 text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)] hover:text-text-secondary transition-colors duration-150"
                >
                  {archiveOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  Archived {archived.length}
                </button>
                {archiveOpen && (
                  <div className="space-y-0.5 mt-1">
                    {archived.map((idea) => (
                      <div
                        key={idea.id}
                        className="group flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-default)] hover:bg-surface-2 transition-colors duration-150"
                      >
                        <span className="flex-1 min-w-0 truncate text-[12px] text-text-muted">
                          {idea.title || "Untitled idea"}
                        </span>
                        <button
                          onClick={() => handleRestoreIdea(idea)}
                          title="Put this idea back in the list"
                          className="shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-text-faint hover:text-gold transition-all duration-150"
                        >
                          Restore
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>


          {/* Compact recording bar */}
          {showCompactBar && (
            <FeedbackRecordingBar
              media={media}
              onExpand={() => setFeedbackMinimized(false)}
            />
          )}

          {/* Bottom buttons */}
          <div className="px-5 py-5 space-y-1">
            <div className="mb-2 px-1">
              <button
                onClick={onOpenAccount}
                className="flex w-full min-w-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-border bg-surface-2 px-2 py-1.5 text-[9px] text-text-faint hover:text-text-muted"
                title={`${isTauri() ? "Desktop app" : "Browser"}; sync ${syncStatus}`}
              >
                <Monitor size={10} className="shrink-0" />
                <span className="truncate">{isTauri() ? "Desktop" : "Browser"} · {syncStatus === "idle" || syncStatus === "syncing" ? "Cloud" : "Local"}</span>
              </button>
            </div>
            <FeedbackButton onClick={openFeedback} />
            <button
              onClick={toggleCommentsPanel}
              className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[12px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150 w-full"
            >
              <MessageSquare size={15} />
              Comments
            </button>
            <button
              onClick={onOpenCalendar}
              className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[12px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150 w-full"
            >
              <CalendarDays size={15} />
              Calendar
            </button>
            <button
              onClick={onOpenHelp}
              className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[12px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150 w-full"
            >
              <HelpCircle size={15} />
              Help
              <kbd className="ml-auto text-[9px] text-text-faint font-[family-name:var(--font-mono)] bg-surface-2 px-1.5 py-0.5 rounded-[4px] border border-border-strong">
                ⌘/
              </kbd>
            </button>
            <button
              onClick={onOpenLogs}
              className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[12px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150 w-full"
            >
              <ScrollText size={15} />
              API Logs
            </button>
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[12px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-colors duration-150 w-full"
            >
              <Settings size={15} />
              Settings
            </button>
          </div>

          {/* One menu for every idea row, rendered outside the sidebar
              entirely (see components/common/context-menu). It used to live
              inside the row, which meant the sidebar's own scroller cut it off
              for any idea far enough down the list: Delete was unreachable on
              exactly the ideas you had most of. */}
          {menuPoint && menuTargets.length > 0 && (
            <ContextMenu
              point={menuPoint}
              onClose={closeMenu}
              header={isBulkMenu ? `${menuTargets.length} ideas` : undefined}
            >
              {isBulkMenu ? (
                <>
                  <ContextMenuItem
                    label={allTargetsPinned ? "Unpin all" : "Pin all"}
                    onClick={() => { closeMenu(); bulkSetPinned(menuTargets, !allTargetsPinned); }}
                  />
                  <PriorityFlagPicker
                    priority={menuTargets.every((idea) => idea.priority === menuTargets[0]?.priority)
                      ? menuTargets[0].priority
                      : null}
                    hint="All selected ideas"
                    onSelect={(priority) => {
                      const targets = menuTargets;
                      closeMenu();
                      bulkSetPriority(targets, priority);
                    }}
                  />
                  <ContextMenuItem
                    label="Group under a new idea"
                    hint="Makes a parent and nests these inside it"
                    onClick={() => { const targets = menuTargets; closeMenu(); bulkGroup(targets); }}
                  />

                  <ContextMenuDivider />

                  <ContextMenuItem
                    label="Archive all"
                    hint="Hides them and their pieces. Nothing is deleted"
                    onClick={() => { const targets = menuTargets; closeMenu(); bulkArchive(targets); }}
                  />
                  <ContextMenuItem
                    label="Delete all"
                    hint="Takes their drafts and pieces with them"
                    destructive
                    onClick={() => { const targets = menuTargets; closeMenu(); bulkDelete(targets); }}
                  />
                </>
              ) : (
                menuTargets.map((idea) => {
                  const isPinned = idea.pinnedAt !== undefined;
                  const ideaPriority = priorityMeta(idea.priority);
                  return (
                    <div key={idea.id}>
                      <ContextMenuItem label="Rename" onClick={() => startRename(idea.id, idea.title)} />
                      <ContextMenuItem
                        label="New draft"
                        hint="A long-form piece in this idea"
                        onClick={() => { closeMenu(); handleNewDraft(idea.id); }}
                      />
                      {idea.parentId === null && (
                        <ContextMenuItem
                          label="New sub-idea"
                          onClick={() => {
                            const childId = createIdea({ title: "Untitled idea", parentId: idea.id });
                            closeMenu();
                            if (childId) {
                              setExpanded((prev) => new Set(prev).add(idea.id));
                              handleSelectIdea(childId);
                              startRename(childId, "Untitled idea");
                            }
                          }}
                        />
                      )}
                      <ContextMenuItem
                        label={isPinned ? "Unpin" : "Pin"}
                        onClick={() => { closeMenu(); if (isPinned) unpinIdea(idea.id); else pinIdea(idea.id); }}
                      />
                      <PriorityFlagPicker
                        priority={idea.priority}
                        hint={ideaPriority?.label ?? "None"}
                        onSelect={(priority) => {
                          closeMenu();
                          setIdeaPriority(idea.id, priority);
                        }}
                      />

                      <ContextMenuDivider />

                      <ContextMenuItem
                        label="Archive idea"
                        hint="Hides it and its pieces. Nothing is deleted"
                        onClick={() => { closeMenu(); handleArchiveIdea(idea); }}
                      />
                      <ContextMenuItem
                        label="Delete idea"
                        hint="Takes its drafts and pieces with it"
                        destructive
                        onClick={() => { closeMenu(); handleDeleteIdea(idea); }}
                      />
                    </div>
                  );
                })
              )}
            </ContextMenu>
          )}
        </>
      )}
    </div>
  );
}
