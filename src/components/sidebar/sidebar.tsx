"use client";

import { useMemo, useState } from "react";
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
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useContentStore } from "@/stores/content-store";
import { pieceCountsForIdea } from "@/stores/content-selectors";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { formatDate } from "@/lib/utils";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { FeedbackPanel, FeedbackRecordingBar } from "@/components/feedback/feedback-panel";
import { useMediaCapture } from "@/components/feedback/use-media-capture";
import type { Idea, Priority } from "@/lib/content-engine";

interface SidebarProps {
  onOpenSettings: () => void;
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

export function Sidebar({ onOpenSettings, onOpenHelp, onOpenLogs }: SidebarProps) {
  const { activeNoteId, setActiveNote, toggleSidebar } = useAppStore();
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const isFeedbackOpen = useAppStore((s) => s.isFeedbackOpen);
  const openFeedback = useAppStore((s) => s.openFeedback);
  const { notes, createNote, deleteNote } = useDataStore();
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);
  const createIdea = useContentStore((s) => s.createIdea);
  const pinIdea = useContentStore((s) => s.pinIdea);
  const unpinIdea = useContentStore((s) => s.unpinIdea);
  const isOnline = useOnlineStatus();
  const [searchQuery, setSearchQuery] = useState("");
  const [ideaSort, setIdeaSort] = useState<IdeaSortMode>("pinned");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Media capture state is shared so the compact bar can control it
  const media = useMediaCapture();
  const [feedbackMinimized, setFeedbackMinimized] = useState(false);

  // Auto-minimize when recording starts, auto-expand when recording stops
  const isActivelyRecording = media.isRecording;
  const showCompactBar = isFeedbackOpen && feedbackMinimized && isActivelyRecording;
  const showFullFeedback = isFeedbackOpen && !showCompactBar;

  const allPieces = useMemo(() => Object.values(pieces), [pieces]);
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
    if (id) setActiveIdea(id);
  }

  function handleDelete(e: React.MouseEvent, noteId: string) {
    e.stopPropagation();
    const nextId = deleteNote(noteId);
    if (activeNoteId === noteId) {
      setActiveNote(nextId);
    }
  }

  function handleSelectIdea(ideaId: string) {
    setActiveIdea(ideaId);
    const linkedPiece = allPieces.find(
      (p) => p.ideaId === ideaId && p.noteId !== undefined && p.deletedAt === undefined,
    );
    setActiveNote(linkedPiece?.noteId ?? null);
  }

  function toggleCollapsed(ideaId: string) {
    setCollapsed((prev) => {
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
    const hasKids = kids.length > 0;
    const isCollapsed = collapsed.has(idea.id);
    const counts = pieceCountsForIdea(idea.id, allPieces);
    const total = counts.inbox + counts["in-progress"] + counts.ready + counts.published;
    const hasUnseenAgent = allPieces.some(
      (p) => p.ideaId === idea.id && p.deletedAt === undefined && !p.seen && p.origin === "agent",
    );
    const menuOpen = openMenuId === idea.id;

    return (
      <div key={idea.id} className={depth === 1 ? "ml-4 pl-3 border-l border-border" : ""}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => handleSelectIdea(idea.id)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelectIdea(idea.id); }}
          className={`group relative flex flex-col w-full text-left px-4 py-3 rounded-[var(--radius-lg)] transition-all duration-150 cursor-pointer
            ${isActive ? "bg-surface-3 border border-border-strong" : "hover:bg-surface-2"}`}
        >
          {isActive && (
            <div className="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded-full bg-gold" />
          )}
          <div className="flex items-center gap-2">
            {depth === 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); if (hasKids) toggleCollapsed(idea.id); }}
                className={`shrink-0 p-0.5 rounded text-text-faint ${hasKids ? "hover:text-text-secondary" : "opacity-0 pointer-events-none"}`}
              >
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </button>
            )}
            {isPinned && <Pin size={10} className="shrink-0 text-gold" fill="currentColor" />}
            <span className={`flex-1 min-w-0 truncate text-[13px] font-medium ${isActive ? "text-text-primary" : "text-text-secondary"}`}>
              {idea.title || "Untitled idea"}
            </span>
            {hasUnseenAgent && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-gold shrink-0"
                style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
              />
            )}
            <div className="relative shrink-0">
              <button
                onClick={(e) => { e.stopPropagation(); setOpenMenuId(menuOpen ? null : idea.id); }}
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(idea.id); }}
                className="opacity-0 group-hover:opacity-100 p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-hover transition-all duration-150"
              >
                <MoreHorizontal size={12} />
              </button>
              {menuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onMouseLeave={() => setOpenMenuId(null)}
                  className="absolute right-0 top-full mt-1 z-30 w-40 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl py-1"
                >
                  <button
                    onClick={() => { isPinned ? unpinIdea(idea.id) : pinIdea(idea.id); setOpenMenuId(null); }}
                    className="block w-full text-left px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
                  >
                    {isPinned ? "Unpin" : "Pin"}
                  </button>
                  {depth === 0 && (
                    <button
                      onClick={() => {
                        const childId = createIdea({ title: "Untitled idea", parentId: idea.id });
                        if (childId) { setCollapsed((prev) => { const n = new Set(prev); n.delete(idea.id); return n; }); handleSelectIdea(childId); }
                        setOpenMenuId(null);
                      }}
                      className="block w-full text-left px-3 py-1.5 text-[12px] text-text-secondary hover:bg-surface-hover transition-colors duration-150"
                    >
                      New sub-idea
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-1 pl-0">
            <span className="text-[11px] text-text-muted truncate">
              {total} {total === 1 ? "piece" : "pieces"}
              {counts.inbox > 0 ? ` · ${counts.inbox} in inbox` : ""}
            </span>
          </div>
        </div>
        {depth === 0 && hasKids && !isCollapsed && (
          <div className="space-y-1 mt-1">
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
              <p className="px-1 pb-3 text-[12px] text-text-faint">
                {searchQuery.trim() ? "No matching ideas" : "No ideas yet — an idea holds a long-form draft plus a short-form feed of pieces"}
              </p>
            ) : (
              <div className="space-y-1 mb-4">
                {visibleRoots.map((idea) => renderIdeaRow(idea, 0))}
              </div>
            )}

            {/* Standalone notes section */}
            <div className="px-1 mb-1.5 mt-2">
              <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
                Notes
              </span>
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

          {/* Compact recording bar */}
          {showCompactBar && (
            <FeedbackRecordingBar
              media={media}
              onExpand={() => setFeedbackMinimized(false)}
            />
          )}

          {/* Bottom buttons */}
          <div className="px-5 py-5 space-y-1">
            <FeedbackButton onClick={openFeedback} />
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
