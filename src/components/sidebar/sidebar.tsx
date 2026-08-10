"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Search,
  HelpCircle,
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
  Download,
  MessageSquare,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { archivedIdeas, draftsForIdea, pieceCountsForIdea, shortformOnly } from "@/stores/content-selectors";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { PRIORITY_OPTIONS, priorityMeta } from "@/lib/priority";
import { useToastStore } from "@/hooks/use-toast";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import { hasAnyWorkingProvider } from "@/lib/ai/connection-status";
import { isTauri } from "@/lib/ai-client";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { FeedbackPanel, FeedbackRecordingBar } from "@/components/feedback/feedback-panel";
import { useMediaCapture } from "@/components/feedback/use-media-capture";
import type { Idea, Priority } from "@/lib/content-engine";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  type Point,
} from "@/components/ui/context-menu";

interface SidebarProps {
  onOpenSettings: () => void;
  /** Render the collapsed strip instead of the full column. Same component so
   * the rail's buttons run the same code paths the full sidebar does. */
  rail?: boolean;
  onOpenAccount: () => void;
  onOpenAI: () => void;
  onOpenHelp: () => void;
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

/**
 * The ⋯ button on an idea row plus the menu it opens. A real component rather
 * than inline JSX so each row can own the refs useMenuPlacement measures: an
 * idea near the bottom of a long sidebar would otherwise open its menu
 * straight into the window's edge, with Delete unreachable.
 */
function IdeaRowMenu({
  open,
  onToggle,
  onOpen,
  onClose,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const placement = useMenuPlacement(open, anchorRef, menuRef);

  return (
    <div ref={anchorRef} className="relative shrink-0">
      <button
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onOpen(); }}
        title="Rename, add a draft, delete…"
        // Always visible, unlike the hover-revealed actions elsewhere in this
        // sidebar: this menu is the only route to renaming and deleting an
        // idea, so hiding it hides the feature.
        className="p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-all duration-150"
      >
        <MoreHorizontal size={12} />
      </button>
      {open && (
        <div
          ref={menuRef}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={onClose}
          className={`absolute right-0 ${placement.className} z-30 w-44 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl py-1 overflow-y-auto`}
          style={{ maxHeight: placement.maxHeight || undefined }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function IdeaMenuItem({
  label,
  hint,
  destructive,
  onClick,
}: {
  label: string;
  hint?: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full text-left px-3 py-1.5 transition-colors duration-150 ${
        destructive
          ? "text-red hover:bg-red-muted"
          : "text-text-secondary hover:bg-surface-hover"
      }`}
    >
      <span className="block text-[12px]">{label}</span>
      {hint && <span className="block text-[10px] text-text-faint">{hint}</span>}
    </button>
  );
}

export function Sidebar({ onOpenSettings, onOpenAccount, onOpenAI, onOpenHelp, onOpenLogs, rail }: SidebarProps) {
  const { toggleSidebar } = useAppStore();
  const pinSidebar = useAppStore((s) => s.pinSidebar);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const setActivePiece = useAppStore((s) => s.setActivePiece);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const isFeedbackOpen = useAppStore((s) => s.isFeedbackOpen);
  const openFeedback = useAppStore((s) => s.openFeedback);
  const toggleCommentsPanel = useAppStore((s) => s.toggleCommentsPanel);
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);
  const createIdea = useContentStore((s) => s.createIdea);
  const createIdeaWithFragment = useContentStore((s) => s.createIdeaWithFragment);
  const createPiece = useContentStore((s) => s.createPiece);
  const updateIdea = useContentStore((s) => s.updateIdea);
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Which row has its priority list expanded, if any. Keyed by id rather
  // than a boolean so closing one menu and opening another never inherits
  // the first one's open submenu.
  const [priorityMenuId, setPriorityMenuId] = useState<string | null>(null);
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

  function childrenFor(idea: Idea): Idea[] {
    const kids = childrenByParent.get(idea.id) ?? [];
    const q = searchQuery.trim();
    const filtered = q && !matches(idea, q) ? kids.filter((c) => matches(c, q)) : kids;
    return sortIdeas(filtered, ideaSort);
  }

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

  function startRename(ideaId: string, currentTitle: string) {
    setOpenMenuId(null);
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
    // Auto-expanded when a child is the open idea, or when a search is on —
    // hiding the row you just matched would be a bug, not tidiness.
    const isExpanded =
      expanded.has(idea.id) ||
      searchQuery.trim() !== "" ||
      kids.some((k) => k.id === activeIdeaId);
    const counts = pieceCountsForIdea(idea.id, shortPieces);
    const total = counts.inbox + counts["in-progress"] + counts.ready + counts.published;
    const summaryLine = `${drafts.length} ${drafts.length === 1 ? "draft" : "drafts"} · ${total} ${total === 1 ? "piece" : "pieces"}${counts.inbox > 0 ? ` · ${counts.inbox} in inbox` : ""}`;
    const hasUnseenAgent = shortPieces.some(
      (p) => p.ideaId === idea.id && p.deletedAt === undefined && !p.seen && p.origin === "agent",
    );
    const menuOpen = openMenuId === idea.id;
    const isRenaming = renamingId === idea.id;

    return (
      <div key={idea.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => handleSelectIdea(idea.id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelectIdea(idea.id); }}
          onDoubleClick={() => startRename(idea.id, idea.title)}
          onContextMenu={(e) => { e.preventDefault(); setOpenMenuId(idea.id); }}
          title={summaryLine}
          className={`group relative flex flex-col w-full text-left px-3 py-2 rounded-[var(--radius-lg)] transition-all duration-150 cursor-pointer
            ${isActive ? "bg-surface-3 border border-border-strong" : "hover:bg-surface-2"}`}
        >
          {isActive && (
            <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gold" />
          )}
          <div className="flex items-center gap-2">
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
            {counts.inbox > 0 && (
              <span
                title={`${counts.inbox} piece${counts.inbox === 1 ? "" : "s"} waiting in this idea's inbox`}
                className="shrink-0 px-1.5 rounded-full text-[10px] font-[family-name:var(--font-mono)] text-gold bg-gold/10 border border-gold/20"
              >
                {counts.inbox}
              </span>
            )}
            {hasUnseenAgent && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-gold shrink-0"
                style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
              />
            )}
            <IdeaRowMenu
              open={menuOpen}
              onToggle={() => { setPriorityMenuId(null); setOpenMenuId(menuOpen ? null : idea.id); }}
              onOpen={() => setOpenMenuId(idea.id)}
              onClose={() => { setPriorityMenuId(null); setOpenMenuId(null); }}
            >
                  <IdeaMenuItem label="Rename" onClick={() => startRename(idea.id, idea.title)} />
                  <IdeaMenuItem
                    label="New draft"
                    hint="A long-form piece in this idea"
                    onClick={() => { setOpenMenuId(null); handleNewDraft(idea.id); }}
                  />
                  {depth === 0 && (
                    <IdeaMenuItem
                      label="New sub-idea"
                      onClick={() => {
                        const childId = createIdea({ title: "Untitled idea", parentId: idea.id });
                        if (childId) {
                          setExpanded((prev) => new Set(prev).add(idea.id));
                          handleSelectIdea(childId);
                          startRename(childId, "Untitled idea");
                        }
                        setOpenMenuId(null);
                      }}
                    />
                  )}
                  <IdeaMenuItem
                    label={isPinned ? "Unpin" : "Pin"}
                    onClick={() => { isPinned ? unpinIdea(idea.id) : pinIdea(idea.id); setOpenMenuId(null); }}
                  />
                  <IdeaMenuItem
                    label="Set priority"
                    hint={ideaPriority ? ideaPriority.label : "None"}
                    onClick={() => setPriorityMenuId(priorityMenuId === idea.id ? null : idea.id)}
                  />
                  {priorityMenuId === idea.id && (
                    <div className="border-t border-border py-1">
                      {PRIORITY_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={(e) => {
                            e.stopPropagation();
                            setIdeaPriority(idea.id, opt.value);
                            setPriorityMenuId(null);
                            setOpenMenuId(null);
                          }}
                          className="block w-full text-left px-4 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="my-1 border-t border-border" />
                  <IdeaMenuItem
                    label="Archive idea"
                    hint="Hides it and its pieces. Nothing is deleted"
                    onClick={() => { setOpenMenuId(null); handleArchiveIdea(idea); }}
                  />
                  <IdeaMenuItem
                    label="Delete idea"
                    hint="Takes its drafts and pieces with it"
                    destructive
                    onClick={() => { setOpenMenuId(null); handleDeleteIdea(idea); }}
                  />
            </IdeaRowMenu>
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

  if (rail) {
    return (
      <div data-sidebar className="flex flex-col items-center h-full w-full py-5 gap-2 bg-surface rounded-[var(--radius-xl)]">
        <RailButton label="Open sidebar" onClick={pinSidebar}>
          <PanelLeftOpen size={16} />
        </RailButton>
        <div className="w-5 border-t border-border my-1" />
        <RailButton label="New idea" onClick={handleNewIdea}>
          <Lightbulb size={16} />
        </RailButton>
        <RailButton
          label="Search ideas and pieces"
          onClick={() => { pinSidebar(); openSearch(); }}
        >
          <Search size={16} />
        </RailButton>
        <div className="flex-1" />
        <RailButton label="Settings" onClick={onOpenSettings}>
          <Settings size={16} />
        </RailButton>
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
              <button
                onClick={toggleSidebar}
                title="Collapse sidebar"
                aria-label="Collapse sidebar"
                className="p-2 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
              >
                <PanelLeftClose size={16} />
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
        </>
      )}
    </div>
  );
}

/** One icon in the collapsed rail. Titles do the labelling, since there is no
 * room for text and an unlabelled strip of icons is a puzzle. */
function RailButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="p-2 rounded-[var(--radius-default)] text-text-muted
        hover:text-text-primary hover:bg-surface-2 transition-all duration-150"
    >
      {children}
    </button>
  );
}
