"use client";

import { useMemo, useRef, useState } from "react";
import {
  Plus,
  PanelLeftClose,
  FileText,
  Trash2,
  Settings,
  Search,
  HelpCircle,
  ScrollText,
  Wifi,
  WifiOff,
  Lightbulb,
  ChevronRight,
  ChevronDown,
  Pin,
  MoreHorizontal,
  Sparkles,
  Monitor,
  Download,
  MessageSquare,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useContentStore } from "@/stores/content-store";
import { draftsForIdea, pieceCountsForIdea, shortformOnly } from "@/stores/content-selectors";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { useToastStore } from "@/hooks/use-toast";
import { useSettingsStore } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import { hasAnyWorkingProvider } from "@/lib/ai/connection-status";
import { isTauri } from "@/lib/ai-client";
import { formatDate } from "@/lib/utils";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { FeedbackPanel, FeedbackRecordingBar } from "@/components/feedback/feedback-panel";
import { useMediaCapture } from "@/components/feedback/use-media-capture";
import type { Idea, Priority } from "@/lib/content-engine";
import { downloadAsMarkdown, latestNoteContentForExport } from "@/lib/export";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
  type Point,
} from "@/components/ui/context-menu";

interface SidebarProps {
  onOpenSettings: () => void;
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

function ideaMatches(idea: Idea, query: string): boolean {
  const q = query.toLowerCase();
  return idea.title.toLowerCase().includes(q) || (idea.summary ?? "").toLowerCase().includes(q);
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

export function Sidebar({ onOpenSettings, onOpenAccount, onOpenAI, onOpenHelp, onOpenLogs }: SidebarProps) {
  const { activeNoteId, setActiveNote, toggleSidebar } = useAppStore();
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const isFeedbackOpen = useAppStore((s) => s.isFeedbackOpen);
  const openFeedback = useAppStore((s) => s.openFeedback);
  const toggleCommentsPanel = useAppStore((s) => s.toggleCommentsPanel);
  const { notes, createNote, deleteNote } = useDataStore();
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);
  const createIdea = useContentStore((s) => s.createIdea);
  const updateIdea = useContentStore((s) => s.updateIdea);
  const pinIdea = useContentStore((s) => s.pinIdea);
  const unpinIdea = useContentStore((s) => s.unpinIdea);
  const linkNoteToIdea = useContentStore((s) => s.linkNoteToIdea);
  const deleteIdeaCascade = useContentStore((s) => s.deleteIdeaCascade);
  const restoreIdeaCascade = useContentStore((s) => s.restoreIdeaCascade);
  const showToast = useToastStore((s) => s.showToast);
  const isOnline = useOnlineStatus();
  const settings = useSettingsStore((s) => s.settings);
  const badProviders = useAppStore((s) => s.badProviders);
  const syncStatus = useSyncStore((s) => s.snapshot.status);
  const aiConnected = hasAnyWorkingProvider(settings, badProviders);
  const [searchQuery, setSearchQuery] = useState("");
  const [ideaSort, setIdeaSort] = useState<IdeaSortMode>("pinned");
  // Sub-ideas start collapsed. The sidebar is a list of ideas to move
  // between; what's *inside* one is the idea workspace panel's job, so the
  // default here is the shortest list that still shows every idea you have.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [noteContextMenu, setNoteContextMenu] = useState<{
    noteId: string;
    position: Point;
  } | null>(null);
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
  const allIdeas = useMemo(() => Object.values(ideas).filter((i) => !i.deletedAt), [ideas]);

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

  const visibleRoots = useMemo(() => {
    const q = searchQuery.trim();
    let roots = rootIdeas;
    if (q) {
      roots = roots.filter(
        (r) => ideaMatches(r, q) || (childrenByParent.get(r.id) ?? []).some((c) => ideaMatches(c, q)),
      );
    }
    return sortIdeas(roots, ideaSort);
  }, [rootIdeas, childrenByParent, searchQuery, ideaSort]);

  function childrenFor(idea: Idea): Idea[] {
    const kids = childrenByParent.get(idea.id) ?? [];
    const q = searchQuery.trim();
    const filtered = q && !ideaMatches(idea, q) ? kids.filter((c) => ideaMatches(c, q)) : kids;
    return sortIdeas(filtered, ideaSort);
  }

  // A note is "idea-less" (standalone) unless some content piece links it as
  // its long-form home (piece.noteId). Notes tied to an idea are reached by
  // selecting that idea, not listed separately here.
  const notesWithIdea = useMemo(() => {
    const set = new Set<string>();
    for (const piece of allPieces) {
      if (piece.noteId && piece.deletedAt === undefined) set.add(piece.noteId);
    }
    return set;
  }, [allPieces]);

  const sortedNotes = useMemo(() => {
    let list = Object.values(notes)
      .filter((n) => !notesWithIdea.has(n.id))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q),
      );
    }
    return list;
  }, [notes, notesWithIdea, searchQuery]);

  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);

  function handleNewNote() {
    const id = createNote();
    setActiveNote(id);
    setActiveIdea(null);
    setShowCreationFlow(true);
  }

  function handleNewIdea() {
    const id = createIdea({ title: "Untitled idea" });
    if (!id) return;
    setActiveIdea(id);
    setActiveNote(null);
    // Straight into rename — an idea called "Untitled idea" is worthless as a
    // container, and naming it is the whole point of creating one.
    startRename(id, "Untitled idea");
  }

  function deleteStandaloneNote(noteId: string) {
    const nextId = deleteNote(noteId);
    if (activeNoteId === noteId) {
      setActiveNote(nextId);
    }
  }

  function handleDelete(e: React.MouseEvent, noteId: string) {
    e.stopPropagation();
    deleteStandaloneNote(noteId);
  }

  function handleOpenNoteFromMenu(noteId: string) {
    setNoteContextMenu(null);
    setActiveIdea(null);
    setActiveNote(noteId);
  }

  function handleExportNote(noteId: string) {
    const note = notes[noteId];
    setNoteContextMenu(null);
    if (!note) return;
    const app = useAppStore.getState();
    const content = latestNoteContentForExport(
      noteId,
      note.content,
      app.liveEditorNoteId,
      app.liveEditorContent,
    );
    downloadAsMarkdown(content, note.title || "Untitled");
  }

  function handleDeleteNoteFromMenu(noteId: string) {
    setNoteContextMenu(null);
    deleteStandaloneNote(noteId);
  }

  /** Select an idea, and with it a draft to write in: the one asked for, else
   * the idea's first draft, else nothing (the editor then offers to start one). */
  function handleSelectIdea(ideaId: string, noteId?: string) {
    setActiveIdea(ideaId);
    if (noteId) {
      setActiveNote(noteId);
      return;
    }
    const drafts = draftsForIdea(ideaId, allPieces);
    setActiveNote(drafts[0]?.noteId ?? null);
  }

  /** Start a fresh long-form draft inside an idea, linked to it from birth. */
  function handleNewDraft(ideaId: string) {
    const noteId = createNote();
    if (!noteId) return;
    linkNoteToIdea(ideaId, noteId);
    setActiveIdea(ideaId);
    setActiveNote(noteId);
    setShowCreationFlow(true);
    setExpanded((prev) => new Set(prev).add(ideaId));
  }

  function handleDeleteIdea(idea: Idea) {
    const cascade = deleteIdeaCascade(idea.id);
    if (!cascade.ideaIds.length) return;
    if (cascade.ideaIds.includes(activeIdeaId ?? "")) {
      setActiveIdea(null);
      setActiveNote(null);
    }
    showToast(`Deleted "${idea.title || "Untitled idea"}"`, {
      label: "Undo",
      onClick: () => restoreIdeaCascade(cascade),
    });
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
              onToggle={() => setOpenMenuId(menuOpen ? null : idea.id)}
              onOpen={() => setOpenMenuId(idea.id)}
              onClose={() => setOpenMenuId(null)}
            >
                  <IdeaMenuItem label="Rename" onClick={() => startRename(idea.id, idea.title)} />
                  <IdeaMenuItem
                    label="New draft"
                    hint="A long-form note in this idea"
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
                  <div className="my-1 border-t border-border" />
                  <IdeaMenuItem
                    label="Delete idea"
                    hint="Drafts return to Notes"
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

  return (
    <div className="flex flex-col h-full w-[300px] bg-surface rounded-[var(--radius-xl)] overflow-hidden">
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
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-default)] transition-all duration-300 ${
                  isOnline
                    ? "text-green"
                    : "text-red bg-red-muted"
                }`}
                title={isOnline ? "Connected" : "Offline — your work is saved locally"}
              >
                {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
                <span className="text-[10px] font-[family-name:var(--font-mono)] font-medium">
                  {isOnline ? "Online" : "Offline"}
                </span>
              </div>
              <button
                onClick={onOpenAI}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-[var(--radius-default)] transition-all duration-300 ${
                  aiConnected ? "text-green" : "text-gold bg-gold/5"
                }`}
                title={aiConnected ? "AI provider configured" : "No AI provider connected"}
              >
                <Sparkles size={12} />
                <span className="text-[10px] font-[family-name:var(--font-mono)] font-medium">
                  {aiConnected ? "AI connected" : "AI not connected"}
                </span>
              </button>
              <button
                onClick={toggleSidebar}
                className="p-2 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
              >
                <PanelLeftClose size={16} />
              </button>
            </div>
          </div>

          {/* New note/idea + search */}
          <div className="px-5 pb-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <button
                onClick={handleNewNote}
                className="flex-1 flex items-center gap-3 px-4 py-3 rounded-[var(--radius-lg)] text-[13px] font-medium
                  bg-surface-2 text-text-secondary border border-border-strong
                  hover:bg-surface-3 hover:text-text-primary hover:border-gold/20 transition-all duration-150"
              >
                <Plus size={15} strokeWidth={2} />
                New note
              </button>
              <button
                onClick={handleNewIdea}
                title="New idea — a home for an idea's long-form draft and its short-form pieces"
                className="shrink-0 flex items-center justify-center w-11 h-11 rounded-[var(--radius-lg)]
                  bg-surface-2 text-text-secondary border border-border-strong
                  hover:bg-surface-3 hover:text-gold hover:border-gold/20 transition-all duration-150"
              >
                <Lightbulb size={15} strokeWidth={2} />
              </button>
            </div>

            <div className="flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-lg)] bg-surface-2 border border-border text-text-faint focus-within:text-text-muted focus-within:border-border-strong transition-colors duration-150">
              <Search size={14} className="shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes & ideas..."
                className="flex-1 bg-transparent text-[13px] text-text-secondary placeholder:text-text-faint outline-none"
              />
            </div>
          </div>

          {/* Idea + note list */}
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
                  : "No ideas yet. An idea is a folder for one thing you're writing about: it holds your long-form drafts and a feed of short-form pieces. Hit the bulb above to make one."}
              </p>
            ) : (
              <>
                <p className="px-1 pb-2 text-[11px] text-text-faint leading-relaxed">
                  Open an idea to work inside it — its drafts and pieces appear in the panel
                  beside this one. Right-click or use ⋯ to rename, add, or delete.
                </p>
                <div className="space-y-1 mb-4">
                  {visibleRoots.map((idea) => renderIdeaRow(idea, 0))}
                </div>
              </>
            )}

            {/* Standalone notes section */}
            <div className="px-1 mb-1.5 mt-2">
              <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
                Notes
              </span>
              <p className="text-[11px] text-text-faint leading-relaxed mt-0.5">
                Notes that don&apos;t belong to any idea.
              </p>
            </div>
            {sortedNotes.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <FileText size={22} className="mx-auto mb-3 text-text-faint opacity-40" />
                <p className="text-[13px] text-text-muted">
                  {searchQuery.trim() ? "No matches" : "No standalone notes"}
                </p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {sortedNotes.map((note) => {
                  const isActive = note.id === activeNoteId && !activeIdeaId;
                  const title = note.title || "Untitled";
                  const preview = note.content
                    ? note.content.replace(/[#*_`>\-\[\]]/g, "").slice(0, 60)
                    : "Empty note";

                  return (
                    <div
                      key={note.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setActiveIdea(null); setActiveNote(note.id); }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setNoteContextMenu({
                          noteId: note.id,
                          position: { x: event.clientX, y: event.clientY },
                        });
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setActiveIdea(null); setActiveNote(note.id); } }}
                      className={`group relative flex flex-col w-full text-left px-4 py-3.5 rounded-[var(--radius-lg)] transition-all duration-150 cursor-pointer
                        ${
                          isActive
                            ? "bg-surface-3 border border-border-strong"
                            : "hover:bg-surface-2"
                        }`}
                    >
                      {isActive && (
                        <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-gold" />
                      )}
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={`text-[13px] font-medium truncate ${isActive ? "text-text-primary" : "text-text-secondary"}`}
                        >
                          {title}
                        </span>
                        <button
                          onClick={(e) => handleDelete(e, note.id)}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-red hover:bg-red-muted transition-all duration-150"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[11px] text-text-muted truncate">
                          {preview}
                        </span>
                        <span className="text-[10px] text-text-faint shrink-0 font-[family-name:var(--font-mono)]">
                          {formatDate(note.updatedAt)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {noteContextMenu && notes[noteContextMenu.noteId] && (
            <ContextMenu
              position={noteContextMenu.position}
              onClose={() => setNoteContextMenu(null)}
              ariaLabel="Note actions"
            >
              <ContextMenuItem
                label="Open"
                icon={<FileText size={13} />}
                onSelect={() => handleOpenNoteFromMenu(noteContextMenu.noteId)}
              />
              <ContextMenuItem
                label="Export as Markdown..."
                icon={<Download size={13} />}
                onSelect={() => handleExportNote(noteContextMenu.noteId)}
              />
              <ContextMenuSeparator />
              <ContextMenuItem
                label="Delete Note"
                icon={<Trash2 size={13} />}
                destructive
                onSelect={() => handleDeleteNoteFromMenu(noteContextMenu.noteId)}
              />
            </ContextMenu>
          )}

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
