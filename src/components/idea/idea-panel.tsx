"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  LayoutList,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useContentStore } from "@/stores/content-store";
import { draftsForIdea, hierarchyRollup, shortformOnly } from "@/stores/content-selectors";
import { useToastStore } from "@/hooks/use-toast";
import { markdownToPlainText } from "@/lib/publish";
import { formatDate, wordCount } from "@/lib/utils";
import type { ContentPiece, PieceStatus } from "@/lib/content-engine";

interface IdeaPanelProps {
  ideaId: string;
}

const STATUS_DOT: Record<PieceStatus, string> = {
  inbox: "bg-text-faint",
  "in-progress": "bg-blue",
  ready: "bg-gold",
  published: "bg-green",
};

const STATUS_WORD: Record<PieceStatus, string> = {
  inbox: "in the inbox, needs a decision",
  "in-progress": "in progress",
  ready: "ready to publish",
  published: "published",
};

/** First non-empty line of a piece, as a plain-text row label — markdown
 * syntax stripped so a `## heading` reads as a title, not as hashes. */
function pieceLabel(piece: ContentPiece): string {
  if (piece.title?.trim()) return piece.title.trim();
  const firstLine = markdownToPlainText(piece.body ?? "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine || "Empty piece";
}

/**
 * The workspace for whichever idea is open: a second column between the
 * sidebar and the editor. The sidebar navigates *across* ideas; this panel
 * shows what's *inside* one — its long-form drafts and its short-form pieces —
 * and the writing surface sits to its right.
 *
 * Clicking a draft opens it in the editor (Write space); clicking a piece
 * opens the short-form feed (Pieces space). Rendered only when an idea is
 * active; collapsing it is a user preference kept in app-store.
 */
export function IdeaPanel({ ideaId }: IdeaPanelProps) {
  const idea = useContentStore((s) => s.ideas[ideaId]);
  const ideas = useContentStore((s) => s.ideas);
  const pieces = useContentStore((s) => s.pieces);
  const updateIdea = useContentStore((s) => s.updateIdea);
  const createPiece = useContentStore((s) => s.createPiece);
  const linkNoteToIdea = useContentStore((s) => s.linkNoteToIdea);
  const notes = useDataStore((s) => s.notes);
  const createNote = useDataStore((s) => s.createNote);
  const deleteNote = useDataStore((s) => s.deleteNote);
  const activeNoteId = useAppStore((s) => s.activeNoteId);
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);
  const space = useAppStore((s) => s.ideaSpaces[ideaId] ?? "write");
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const setIdeaPanelOpen = useAppStore((s) => s.setIdeaPanelOpen);
  const revealPiece = useAppStore((s) => s.revealPiece);
  const showToast = useToastStore((s) => s.showToast);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

  const allPieces = useMemo(() => Object.values(pieces), [pieces]);
  const drafts = useMemo(() => draftsForIdea(ideaId, allPieces), [ideaId, allPieces]);
  // Rolled up so a parent idea's workspace shows the pieces of its children
  // too — same rule the Pieces feed uses.
  const shortPieces = useMemo(
    () =>
      shortformOnly(hierarchyRollup(ideaId, Object.values(ideas), allPieces)).sort(
        (a, b) => b.updatedAt - a.updatedAt,
      ),
    [ideaId, ideas, allPieces],
  );
  // Untriaged pieces are the ones that owe you a decision, so they list
  // first and separately — the panel should say "three waiting", not bury
  // them among everything you already dealt with.
  const inboxPieces = useMemo(
    () => shortPieces.filter((p) => p.status === "inbox"),
    [shortPieces],
  );
  const triagedPieces = useMemo(
    () => shortPieces.filter((p) => p.status !== "inbox"),
    [shortPieces],
  );

  if (!idea) return null;

  function commitTitle() {
    const next = titleDraft.trim();
    if (next) updateIdea(ideaId, { title: next });
    setEditingTitle(false);
  }

  function openDraft(noteId: string) {
    setActiveNote(noteId);
    setIdeaSpace(ideaId, "write");
  }

  function handleNewDraft() {
    const noteId = createNote();
    if (!noteId) return;
    linkNoteToIdea(ideaId, noteId);
    setActiveNote(noteId);
    setIdeaSpace(ideaId, "write");
    setShowCreationFlow(true);
  }

  function handleDeleteDraft(e: React.MouseEvent, noteId: string) {
    e.stopPropagation();
    deleteNote(noteId);
    if (activeNoteId === noteId) {
      const next = drafts.find((d) => d.noteId !== noteId);
      setActiveNote(next?.noteId ?? null);
    }
  }

  /** Open the pieces feed with this exact piece selected and scrolled to —
   * the panel is a table of contents, so a click has to land somewhere. */
  function openPiece(pieceId: string) {
    setIdeaSpace(ideaId, "pieces");
    revealPiece(pieceId);
  }

  function handleNewPiece() {
    const id = createPiece({ ideaId, format: "other", origin: "user", body: "" });
    if (!id) return;
    openPiece(id);
    showToast("Piece added — edit it in the feed");
  }

  return (
    <div className="flex flex-col h-full w-[268px] bg-surface rounded-[var(--radius-xl)] overflow-hidden">
      {/* Header: which idea you're inside */}
      <div className="px-5 pt-6 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
            Idea
          </span>
          <button
            onClick={() => setIdeaPanelOpen(false)}
            title="Collapse this panel"
            className="p-1.5 rounded-[var(--radius-default)] text-text-faint hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>

        {editingTitle ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTitle();
              if (e.key === "Escape") setEditingTitle(false);
            }}
            className="w-full bg-surface-2 border border-border-active rounded-[var(--radius-sm)] px-2 py-1
              font-[family-name:var(--font-display)] text-[15px] text-text-primary outline-none"
          />
        ) : (
          <button
            onClick={() => { setTitleDraft(idea.title); setEditingTitle(true); }}
            title="Click to rename"
            className="block w-full text-left font-[family-name:var(--font-display)] text-[15px] leading-snug
              text-text-primary hover:text-gold transition-colors duration-150"
          >
            {idea.title || "Untitled idea"}
          </button>
        )}

        <textarea
          value={idea.summary ?? ""}
          onChange={(e) => updateIdea(ideaId, { summary: e.target.value })}
          placeholder="What's this idea about? (optional)"
          rows={2}
          className="mt-2 w-full bg-transparent resize-none outline-none
            text-[11px] leading-relaxed text-text-muted placeholder:text-text-faint"
        />
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
        {/* Drafts — the long-form notes that live in this idea */}
        <section>
          <SectionHeader
            label="Drafts"
            count={drafts.length}
            actionLabel="New draft"
            onAction={handleNewDraft}
          />
          <p className="text-[10px] text-text-faint leading-relaxed mb-2">
            Long-form writing inside this idea. Click one to open it in the editor.
          </p>
          {drafts.length === 0 ? (
            <button
              onClick={handleNewDraft}
              className="flex items-center gap-1.5 w-full px-3 py-2.5 rounded-[var(--radius-default)]
                border border-dashed border-border-strong text-[11px] text-text-faint
                hover:text-gold hover:border-gold/30 transition-all duration-150"
            >
              <Plus size={11} />
              Start the first draft
            </button>
          ) : (
            <div className="space-y-0.5">
              {drafts.map((piece) => {
                const noteId = piece.noteId;
                if (!noteId) return null;
                const note = notes[noteId];
                if (!note) return null;
                const isActive = activeNoteId === noteId && space === "write";
                return (
                  <div
                    key={piece.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openDraft(noteId)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openDraft(noteId); }}
                    className={`group relative flex flex-col px-3 py-2 rounded-[var(--radius-default)] cursor-pointer transition-colors duration-150
                      ${isActive ? "bg-surface-3" : "hover:bg-surface-2"}`}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gold" />
                    )}
                    <div className="flex items-center gap-2">
                      <FileText size={11} className={`shrink-0 ${isActive ? "text-gold" : "text-text-faint"}`} />
                      <span className={`flex-1 min-w-0 truncate text-[12px] ${isActive ? "text-text-primary" : "text-text-secondary"}`}>
                        {note.title.trim() || "Untitled draft"}
                      </span>
                      <button
                        onClick={(e) => handleDeleteDraft(e, noteId)}
                        title="Delete this draft"
                        className="opacity-0 group-hover:opacity-100 p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-red hover:bg-red-muted transition-all duration-150"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                    <span className="pl-[19px] text-[10px] text-text-faint font-[family-name:var(--font-mono)]">
                      {wordCount(note.content)} words · {formatDate(note.updatedAt)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Pieces — the short-form feed, summarised */}
        <section>
          <SectionHeader
            label="Pieces"
            count={shortPieces.length}
            actionLabel="New piece"
            onAction={handleNewPiece}
          />
          <p className="text-[10px] text-text-faint leading-relaxed mb-2">
            Short-form posts drawn from this idea. Click one to open the feed.
          </p>
          {shortPieces.length === 0 ? (
            <p className="px-3 py-2 text-[11px] text-text-faint">
              Nothing yet. Snip from a draft, or let an agent drop one in.
            </p>
          ) : (
            <div className="space-y-3">
              {inboxPieces.length > 0 && (
                <div>
                  <button
                    onClick={() => setIdeaSpace(ideaId, "pieces")}
                    title="Open the feed to triage these"
                    className="flex items-center gap-1.5 mb-1 text-[10px] uppercase tracking-wider
                      text-gold font-[family-name:var(--font-mono)] hover:opacity-80 transition-opacity duration-150"
                  >
                    Inbox {inboxPieces.length}
                    <span className="normal-case tracking-normal text-text-faint">
                      · needs a decision
                    </span>
                  </button>
                  <div className="space-y-0.5">
                    {inboxPieces.slice(0, 8).map((piece) => (
                      <PieceRow key={piece.id} piece={piece} onOpen={() => openPiece(piece.id)} />
                    ))}
                  </div>
                  {inboxPieces.length > 8 && (
                    <MoreInFeed
                      count={inboxPieces.length - 8}
                      onClick={() => setIdeaSpace(ideaId, "pieces")}
                    />
                  )}
                </div>
              )}

              {triagedPieces.length > 0 && (
                <div>
                  {inboxPieces.length > 0 && (
                    <div className="mb-1 text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
                      Working
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {triagedPieces.slice(0, 8).map((piece) => (
                      <PieceRow key={piece.id} piece={piece} onOpen={() => openPiece(piece.id)} />
                    ))}
                  </div>
                  {triagedPieces.length > 8 && (
                    <MoreInFeed
                      count={triagedPieces.length - 8}
                      onClick={() => setIdeaSpace(ideaId, "pieces")}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Jump to the space this panel isn't currently showing */}
      <div className="px-5 py-4 shrink-0 border-t border-border">
        <button
          onClick={() => setIdeaSpace(ideaId, space === "write" ? "pieces" : "write")}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-[var(--radius-default)]
            text-[11px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
        >
          {space === "write" ? <LayoutList size={12} /> : <FileText size={12} />}
          {space === "write" ? "Open the pieces feed" : "Back to the draft"}
          <kbd className="ml-auto text-[9px] text-text-faint font-[family-name:var(--font-mono)] bg-surface-2 px-1.5 py-0.5 rounded-[4px] border border-border-strong">
            {space === "write" ? "⌘2" : "⌘1"}
          </kbd>
        </button>
      </div>
    </div>
  );
}

/**
 * Re-opens the idea workspace after it's been collapsed. Sits in the center
 * panel's toolbar next to the Write | Pieces toggle, mirroring how the
 * sidebar's own collapse/expand pair works.
 */
export function IdeaPanelToggle() {
  const ideaPanelOpen = useAppStore((s) => s.ideaPanelOpen);
  const setIdeaPanelOpen = useAppStore((s) => s.setIdeaPanelOpen);
  if (ideaPanelOpen) return null;

  return (
    <button
      onClick={() => setIdeaPanelOpen(true)}
      title="Show this idea's drafts and pieces"
      className="shrink-0 p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
    >
      <PanelLeftOpen size={16} />
    </button>
  );
}

/** One piece as a table-of-contents row: a status dot (grey inbox, blue in
 * progress, gold ready, green published), the plain-text label, and the unseen
 * pulse for anything an agent pushed that you haven't looked at yet.
 *
 * The row also mirrors the feed: whichever piece has roving focus over there
 * gets the gold rail here, and hovering a card lights up its row, so the panel
 * answers "where am I" without you having to find the highlighted card. */
function PieceRow({ piece, onOpen }: { piece: ContentPiece; onOpen: () => void }) {
  const focusedPieceId = useAppStore((s) => s.focusedPieceId);
  const hoveredPieceId = useAppStore((s) => s.hoveredPieceId);
  const setHoveredPiece = useAppStore((s) => s.setHoveredPiece);
  const isFocused = focusedPieceId === piece.id;
  const isHovered = hoveredPieceId === piece.id;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(); }}
      onMouseEnter={() => setHoveredPiece(piece.id)}
      onMouseLeave={() => setHoveredPiece(null)}
      title={`${pieceLabel(piece)} — ${STATUS_WORD[piece.status]}`}
      className={`relative flex items-center gap-2 px-3 py-2 rounded-[var(--radius-default)] cursor-pointer transition-colors duration-150 ${
        isFocused ? "bg-surface-3" : isHovered ? "bg-surface-2" : "hover:bg-surface-2"
      }`}
    >
      {isFocused && <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gold" />}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[piece.status]}`} />
      <span
        className={`flex-1 min-w-0 truncate text-[12px] ${isFocused ? "text-text-primary" : "text-text-muted"}`}
      >
        {pieceLabel(piece)}
      </span>
      {!piece.seen && piece.origin === "agent" && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-gold shrink-0"
          style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
        />
      )}
    </div>
  );
}

function MoreInFeed({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full px-3 py-2 text-left text-[11px] text-text-faint hover:text-gold transition-colors duration-150"
    >
      {count} more in the feed →
    </button>
  );
}

function SectionHeader({
  label,
  count,
  actionLabel,
  onAction,
}: {
  label: string;
  count: number;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-0.5">
      <span className="text-[10px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
        {label} {count > 0 && <span className="text-text-muted">{count}</span>}
      </span>
      <button
        onClick={onAction}
        title={actionLabel}
        className="p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-gold hover:bg-surface-2 transition-all duration-150"
      >
        <Plus size={12} />
      </button>
    </div>
  );
}
