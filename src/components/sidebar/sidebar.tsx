"use client";

import { useMemo, useState } from "react";
import { Plus, PanelLeftClose, FileText, Trash2, Settings, Search, HelpCircle, ScrollText, Wifi, WifiOff } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { formatDate } from "@/lib/utils";
import { FeedbackButton } from "@/components/feedback/feedback-button";
import { FeedbackPanel, FeedbackRecordingBar } from "@/components/feedback/feedback-panel";
import { useMediaCapture } from "@/components/feedback/use-media-capture";

interface SidebarProps {
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onOpenLogs: () => void;
}

export function Sidebar({ onOpenSettings, onOpenHelp, onOpenLogs }: SidebarProps) {
  const { activeNoteId, setActiveNote, toggleSidebar } = useAppStore();
  const isFeedbackOpen = useAppStore((s) => s.isFeedbackOpen);
  const openFeedback = useAppStore((s) => s.openFeedback);
  const { notes, createNote, deleteNote } = useDataStore();
  const isOnline = useOnlineStatus();
  const [searchQuery, setSearchQuery] = useState("");

  // Media capture state is shared so the compact bar can control it
  const media = useMediaCapture();
  const [feedbackMinimized, setFeedbackMinimized] = useState(false);

  // Auto-minimize when recording starts, auto-expand when recording stops
  const isActivelyRecording = media.isRecording;
  const showCompactBar = isFeedbackOpen && feedbackMinimized && isActivelyRecording;
  const showFullFeedback = isFeedbackOpen && !showCompactBar;

  const sortedNotes = useMemo(() => {
    let list = Object.values(notes).sort((a, b) => b.updatedAt - a.updatedAt);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q),
      );
    }
    return list;
  }, [notes, searchQuery]);

  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);

  function handleNewNote() {
    const id = createNote();
    setActiveNote(id);
    setShowCreationFlow(true);
  }

  function handleDelete(e: React.MouseEvent, noteId: string) {
    e.stopPropagation();
    const nextId = deleteNote(noteId);
    if (activeNoteId === noteId) {
      setActiveNote(nextId);
    }
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

          {/* New note + search */}
          <div className="px-5 pb-4 space-y-2.5">
            <button
              onClick={handleNewNote}
              className="flex items-center gap-3 w-full px-4 py-3 rounded-[var(--radius-lg)] text-[13px] font-medium
                bg-surface-2 text-text-secondary border border-border-strong
                hover:bg-surface-3 hover:text-text-primary hover:border-gold/20 transition-all duration-150"
            >
              <Plus size={15} strokeWidth={2} />
              New note
            </button>

            <div className="flex items-center gap-3 px-4 py-2.5 rounded-[var(--radius-lg)] bg-surface-2 border border-border text-text-faint focus-within:text-text-muted focus-within:border-border-strong transition-colors duration-150">
              <Search size={14} className="shrink-0" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search notes..."
                className="flex-1 bg-transparent text-[13px] text-text-secondary placeholder:text-text-faint outline-none"
              />
            </div>
          </div>

          {/* Note list */}
          <div className="flex-1 overflow-y-auto px-5 py-2">
            {sortedNotes.length === 0 ? (
              <div className="px-4 py-16 text-center">
                <FileText size={24} className="mx-auto mb-3 text-text-faint opacity-40" />
                <p className="text-[13px] text-text-muted">
                  {searchQuery.trim() ? "No matches" : "No notes yet"}
                </p>
                {!searchQuery.trim() && (
                  <p className="text-[12px] text-text-faint mt-2">
                    Create one to start writing
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-1.5">
                {sortedNotes.map((note) => {
                  const isActive = note.id === activeNoteId;
                  const title = note.title || "Untitled";
                  const preview = note.content
                    ? note.content.replace(/[#*_`>\-\[\]]/g, "").slice(0, 60)
                    : "Empty note";

                  return (
                    <div
                      key={note.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setActiveNote(note.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setActiveNote(note.id); }}
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
