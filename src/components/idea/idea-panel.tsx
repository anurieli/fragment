"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Flag,
  LayoutList,
  Lock,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import {
  draftsForIdea,
  hierarchyRollup,
  shortformOnly,
  unarchived,
} from "@/stores/content-selectors";
import { useToastStore } from "@/hooks/use-toast";
import {
  ContextMenu,
  ContextMenuDivider,
  ContextMenuItem,
  useContextMenu,
} from "@/components/common/context-menu";
import { PieceMenuItems, PieceShapeItems } from "@/components/shortform/piece-menu-items";
import { MarkPublishedMenuSection } from "@/components/publish/mark-published-menu-section";
import { MarkPublishedDialog } from "@/components/publish/mark-published-dialog";
import { useExtractIdeas } from "@/hooks/use-extract-ideas";
import { markdownToPlainText } from "@/lib/publish";
import { moveToSection, type PanelSection } from "@/lib/piece-section";
import { priorityMeta } from "@/lib/priority";
import { formatDate, wordCount } from "@/lib/utils";
import { findOriginComment } from "@/lib/persistence";
import type { Comment } from "@/lib/types";
import type { ContentPiece, Idea, PieceStatus } from "@/lib/content-engine";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { resolveVoice } from "@/lib/voice-context";
import { inheritedBrief } from "@/lib/brief-context";
import { BriefField } from "@/components/editor/brief-field";

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

/** First non-empty line of a piece, as a plain-text row label: markdown
 * syntax stripped so a `## heading` reads as a title, not as hashes. `empty`
 * names what a piece with nothing in it is called on the surface asking. */
function pieceLabel(piece: ContentPiece, empty = "Empty piece"): string {
  if (piece.title?.trim()) return piece.title.trim();
  const firstLine = markdownToPlainText(piece.body)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine || empty;
}

/**
 * What a rename box opens with. The piece's own title if it has one, else the
 * line the row is currently showing — but never the "Untitled draft" / "Empty
 * piece" placeholder, which is the app admitting it has no name, not a name
 * anyone would want to edit. Hence `pieceLabel(piece, "")`.
 */
function renameSeed(piece: ContentPiece): string {
  return piece.title?.trim() || pieceLabel(piece, "");
}

/**
 * The inline rename box, shared by draft rows and piece rows so the two cannot
 * drift apart. Enter commits, Escape cancels, and clicking away commits —
 * leaving a text box by clicking elsewhere is what people do, and throwing the
 * words away for it punishes the wrong thing.
 *
 * Every event is stopped at the input: the row around it is a button that
 * opens the piece, and the app shell listens for Escape and ⌘1/⌘2 globally.
 */
function RenameInput({
  seed,
  placeholder,
  onCommit,
  onCancel,
}: {
  seed: string;
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(seed);

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => onCommit(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onCommit(value);
        if (e.key === "Escape") onCancel();
      }}
      placeholder={placeholder}
      className="flex-1 min-w-0 bg-surface-2 border border-border-active rounded-[var(--radius-sm)]
        px-1.5 py-0.5 text-[12px] text-text-primary outline-none"
    />
  );
}

/** How far the pointer has to travel before a press on a row becomes a drag
 * rather than a click. Same 5px the Snip Bar's cards use, so the two kinds of
 * drag feel identical to the hand. */
const DRAG_THRESHOLD = 5;

/**
 * One of the panel's two lists, wearing a drop target.
 *
 * The zone is marked with data attributes rather than React handlers because
 * the things dropped on it arrive from a custom mouse drag, not from HTML5
 * drag-and-drop: a snip card resolves its drop with `elementFromPoint` and
 * then `closest("[data-idea-drop]")`, exactly as it already does for the
 * feed's `[data-piece-separator]`. Native DnD is unusable in Tauri's WebView,
 * which is why the whole app drags this way.
 *
 * It only lights up when something is actually in flight and this list is not
 * where that something came from — an invitation to drop a draft into Drafts
 * is a lie, since nothing would happen.
 */
function DropSection({
  section,
  ideaId,
  children,
}: {
  section: PanelSection;
  ideaId: string;
  children: React.ReactNode;
}) {
  const draggingSnip = useAppStore((s) => s.isDraggingToEditor);
  const panelDrag = useAppStore((s) => s.panelDrag);
  const [hover, setHover] = useState(false);

  const invited = draggingSnip || (panelDrag !== null && panelDrag.from !== section);
  const active = invited && hover;

  return (
    <section
      data-idea-drop={section}
      data-idea-id={ideaId}
      onMouseEnter={() => { if (invited) setHover(true); }}
      onMouseLeave={() => setHover(false)}
      className={`relative rounded-[var(--radius-default)] transition-all duration-150 ${
        active ? "bg-gold-muted/20 outline outline-1 outline-gold/40 -outline-offset-1" : ""
      }`}
    >
      {children}
    </section>
  );
}

/**
 * Press-and-move on a row to carry the fragment to the other list.
 *
 * Deliberately not `preventDefault`ing the mousedown the way the Snip Bar's
 * cards do: these rows are focusable buttons, and swallowing the default would
 * cost them their focus ring on click. Text selection is suppressed only once
 * a drag has genuinely started.
 *
 * `dragged` exists because a mouseup at the end of a drag still produces a
 * click, and a click on one of these rows opens the fragment. It is cleared on
 * the next tick so the click that follows is the only one it swallows.
 */
function useRowDrag(
  piece: ContentPiece,
  from: PanelSection,
  onMove: (to: PanelSection) => void,
) {
  const dragged = useRef(false);
  const label = pieceLabel(piece, from === "drafts" ? "Untitled draft" : "Empty piece");

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      // Buttons act, inputs take text. Neither is a handle.
      if ((e.target as HTMLElement).closest("button, input, textarea")) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const onMouseMove = (ev: MouseEvent) => {
        if (dragging) return;
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        dragging = true;
        dragged.current = true;
        document.body.style.userSelect = "none";
        useAppStore.getState().setPanelDrag({ pieceId: piece.id, from });
        // The same card the Snip Bar flies. "Draft"/"Piece" sits where a
        // snip's AI label would, because what you are carrying is a whole
        // fragment and the useful thing to say about it is what it is now.
        useAppStore.getState().setFloatingDragCard({
          content: label,
          label: from === "drafts" ? "Draft" : "Piece",
          labelStatus: "done",
        });
      };

      const onMouseUp = (ev: MouseEvent) => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        if (!dragging) return;

        document.body.style.userSelect = "";
        useAppStore.getState().setPanelDrag(null);
        useAppStore.getState().setFloatingDragCard(null);
        setTimeout(() => { dragged.current = false; }, 0);

        const target = document.elementFromPoint(ev.clientX, ev.clientY);
        const zone = (target as Element | null)?.closest?.("[data-idea-drop]");
        const to = zone?.getAttribute("data-idea-drop") as PanelSection | null;
        if (to && to !== from) onMove(to);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [piece.id, from, label, onMove],
  );

  return { onMouseDown, dragged };
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
  const updatePiece = useContentStore((s) => s.updatePiece);
  const createPiece = useContentStore((s) => s.createPiece);
  const deletePieceCascade = useContentStore((s) => s.deletePieceCascade);
  const restorePieceCascade = useContentStore((s) => s.restorePieceCascade);
  const archivePiece = useContentStore((s) => s.archivePiece);
  const unarchivePiece = useContentStore((s) => s.unarchivePiece);
  const activePieceId = useAppStore((s) => s.activePieceId);
  const setActivePiece = useAppStore((s) => s.setActivePiece);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const setCommentsPanelOpen = useAppStore((s) => s.setCommentsPanelOpen);
  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);
  const space = useAppStore((s) => s.ideaSpaces[ideaId] ?? "write");
  const setIdeaSpace = useAppStore((s) => s.setIdeaSpace);
  const setIdeaPanelOpen = useAppStore((s) => s.setIdeaPanelOpen);
  const revealPiece = useAppStore((s) => s.revealPiece);
  const showToast = useToastStore((s) => s.showToast);
  // One controller owns every extraction surface in this panel. A draft's
  // context menu disappears as soon as its action is chosen, so keeping the
  // hook inside that menu used to throw away the only visible working state.
  const extractor = useExtractIdeas();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // The comment that seeded this idea via "Turn into an idea", if any —
  // looked up directly (not through data-store's comments window, which only
  // ever holds the active note/idea's comments, and the source is usually a
  // different one). See findOriginComment in persistence.ts.
  const [originComment, setOriginComment] = useState<Comment | null>(null);

  useEffect(() => {
    let cancelled = false;
    findOriginComment(ideaId).then((comment) => {
      if (!cancelled) setOriginComment(comment);
    });
    return () => { cancelled = true; };
  }, [ideaId]);

  const allPieces = useMemo(() => Object.values(pieces), [pieces]);
  const drafts = useMemo(() => draftsForIdea(ideaId, allPieces), [ideaId, allPieces]);
  // Rolled up so a parent idea's workspace shows the pieces of its children
  // too — same rule the Pieces feed uses.
  const shortPieces = useMemo(
    () =>
      unarchived(
        shortformOnly(hierarchyRollup(ideaId, Object.values(ideas), allPieces)),
      ).sort((a, b) => {
        // Pinned first, exactly as the feed orders them, so the panel and the
        // feed never disagree about what is at the top.
        const aPinned = a.pinnedAt !== undefined;
        const bPinned = b.pinnedAt !== undefined;
        if (aPinned !== bPinned) return aPinned ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      }),
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

  /** Jump to wherever the originating comment lives and open the Comments
   * panel on it — the idea view's "Started from a comment" backlink. */
  function openOriginComment() {
    if (!originComment) return;
    if (originComment.pieceId) {
      setActivePiece(originComment.pieceId);
    } else if (originComment.ideaId) {
      setActiveIdea(originComment.ideaId);
      setIdeaSpace(originComment.ideaId, "pieces");
    }
    setCommentsPanelOpen(true);
  }

  function openDraft(pieceId: string) {
    setActivePiece(pieceId);
    setIdeaSpace(ideaId, "write");
  }

  function handleNewDraft() {
    const pieceId = createPiece({
      ideaId,
      // Long-form, so it opens in the editor rather than as a card in the feed.
      format: "essay",
      origin: "user",
      status: "in-progress",
      seen: true,
    });
    if (!pieceId) return;
    setActivePiece(pieceId);
    setIdeaSpace(ideaId, "write");
    setShowCreationFlow(true);
  }

  /** Move the editor off a piece that is about to stop being visible here,
   * whether it was deleted or archived. The cascade hands back the piece to
   * look at next, so leaving this list never leaves the editor pointed at
   * something that is gone. The idea's remaining drafts come first: this list
   * is what the eye is on, and the cascade's answer can be any piece in the
   * idea, card included. */
  function selectAfterLeaving(pieceId: string, fallback: string | null) {
    if (activePieceId !== pieceId) return;
    const nextDraft = drafts.find((d) => d.id !== pieceId);
    setActivePiece(nextDraft?.id ?? fallback);
  }

  function handleDeleteDraft(pieceId: string) {
    const next = deletePieceCascade(pieceId);
    selectAfterLeaving(pieceId, next);
    showToast("Draft deleted", {
      label: "Undo",
      onClick: () => restorePieceCascade(pieceId),
    });
  }

  function handleArchiveDraft(pieceId: string) {
    archivePiece(pieceId);
    const next = drafts.find((d) => d.id !== pieceId)?.id ?? null;
    selectAfterLeaving(pieceId, next);
    showToast("Draft archived", {
      label: "Undo",
      onClick: () => unarchivePiece(pieceId),
    });
  }

  /**
   * Rename from the row. An empty name is not a refusal to rename, it is
   * asking for the name back: a piece with no title of its own labels itself
   * with its first line, so clearing the box returns the row to following the
   * writing instead of freezing whatever it said the day it was named.
   */
  function handleRenamePiece(pieceId: string, title: string) {
    updatePiece(pieceId, { title: title.trim() });
  }

  /**
   * Carry a fragment between the panel's two lists. Nothing is created and
   * nothing is copied: the same fragment changes shape, so its words, its
   * brief, its snips and its history all come with it (see piece-section.ts).
   *
   * Undo puts back the exact format and status it had, which matters most for
   * a short-form piece that named a platform — Drafts has nowhere to keep
   * "linkedin", so only the undo can give it back.
   */
  function handleMovePiece(pieceId: string, to: PanelSection) {
    const piece = pieces[pieceId];
    if (!piece) return;
    const change = moveToSection(piece, to);
    if (!change) return;
    const before = { format: piece.format, status: piece.status };

    updatePiece(pieceId, change);
    // A draft that has become a card is gone from the editor's list, so the
    // editor cannot be left pointing at it.
    if (to === "pieces") {
      selectAfterLeaving(pieceId, drafts.find((d) => d.id !== pieceId)?.id ?? null);
    }
    showToast(to === "drafts" ? "Moved into Drafts" : "Moved into Pieces", {
      label: "Undo",
      onClick: () => updatePiece(pieceId, before),
    });
  }

  function handleDeletePiece(pieceId: string) {
    const next = deletePieceCascade(pieceId);
    selectAfterLeaving(pieceId, next);
    showToast("Piece deleted", {
      label: "Undo",
      onClick: () => restorePieceCascade(pieceId),
    });
  }

  /** Open the pieces feed with this exact piece selected and scrolled to —
   * the panel is a table of contents, so a click has to land somewhere. */
  function openPiece(pieceId: string) {
    setIdeaSpace(ideaId, "pieces");
    revealPiece(pieceId);
  }

  function handleNewPiece() {
    const id = createPiece({
      ideaId,
      format: "other",
      origin: "user",
      status: "in-progress",
      body: "",
      seen: true,
    });
    if (!id) return;
    openPiece(id);
    showToast("Piece added. Edit it in the feed.");
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

        {originComment && (
          <button
            onClick={openOriginComment}
            title="Open the comment this idea started from"
            className="mt-2 flex items-center gap-1.5 text-[10px] text-text-faint hover:text-gold transition-colors duration-150"
          >
            <MessageSquare size={10} />
            Started from a comment
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-4 space-y-5">
        {/* Brief: the middle tier. Set once here and every piece in the idea
            follows, unless it says otherwise. Blank inherits from the voice
            (audience, tone, remember) — goal has no voice above it. */}
        <IdeaBrief ideaId={ideaId} idea={idea} />

        {/* Drafts: the long-form pieces that live in this idea. Also a drop
            target for a snip from the bar, or a piece from the list below. */}
        <DropSection section="drafts" ideaId={ideaId}>
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
              {drafts.map((piece) => (
                <DraftRow
                  key={piece.id}
                  piece={piece}
                  isActive={activePieceId === piece.id && space === "write"}
                  onOpen={() => openDraft(piece.id)}
                  onRename={(title) => handleRenamePiece(piece.id, title)}
                  onMove={(to) => handleMovePiece(piece.id, to)}
                  onExtract={() => { void extractor.extract({ kind: "piece", pieceId: piece.id }); }}
                  extractDisabled={extractor.isExtracting}
                  onArchive={() => handleArchiveDraft(piece.id)}
                  onDelete={() => handleDeleteDraft(piece.id)}
                />
              ))}
            </div>
          )}
        </DropSection>

        {/* Pieces: the short-form feed, summarised. Same drop target as above,
            so a snip or a draft can be dropped straight into it. */}
        <DropSection section="pieces" ideaId={ideaId}>
          <SectionHeader
            label="Pieces"
            count={shortPieces.length}
            actionLabel="New piece"
            onAction={handleNewPiece}
          />
          <p className="text-[10px] text-text-faint leading-relaxed mb-2">
            Short-form posts drawn from this idea. Click one to open the feed.
          </p>
          <ExtractButton
            onExtract={() => { void extractor.extract({ kind: "idea", ideaId }); }}
            isExtracting={extractor.isExtracting}
            activeLabel={extractor.activeLabel}
          />
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
                      <PieceRow
                        key={piece.id}
                        piece={piece}
                        onOpen={() => openPiece(piece.id)}
                        onRename={(title) => handleRenamePiece(piece.id, title)}
                        onMove={(to) => handleMovePiece(piece.id, to)}
                        onDelete={() => handleDeletePiece(piece.id)}
                      />
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
                      <PieceRow
                        key={piece.id}
                        piece={piece}
                        onOpen={() => openPiece(piece.id)}
                        onRename={(title) => handleRenamePiece(piece.id, title)}
                        onMove={(to) => handleMovePiece(piece.id, to)}
                        onDelete={() => handleDeletePiece(piece.id)}
                      />
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
        </DropSection>
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
/**
 * The idea's writing brief. Collapsed by default: most ideas never need one,
 * and the fields that matter show what they inherit the moment you open it.
 *
 * Goal sits here as well as on a piece, but has no voice tier above it — an
 * idea is a subject with a point to make, a voice is not.
 */
function IdeaBrief({ ideaId, idea }: { ideaId: string; idea: Idea }) {
  const updateIdea = useContentStore((s) => s.updateIdea);
  const voicesMap = useVoiceStore((s) => s.voices);
  const defaultVoiceId = useSettingsStore((s) => s.settings.brandVoice.defaultVoiceId);
  const voicesList = useMemo(
    () => Object.values(voicesMap).sort((a, b) => a.createdAt - b.createdAt),
    [voicesMap],
  );
  const voice = resolveVoice(voicesMap, defaultVoiceId, idea.voiceId);
  const inherited = useMemo(() => inheritedBrief("idea", { idea, voice }), [idea, voice]);

  const isSet = !!(idea.goal || idea.audience || idea.tone || idea.remember);
  const [open, setOpen] = useState(isSet);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-faint
          hover:text-text-secondary font-[family-name:var(--font-mono)] transition-colors duration-150"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        Brief
        {!open && isSet && <span className="normal-case tracking-normal text-text-muted">set</span>}
      </button>

      {open && (
        <div
          className="mt-2 space-y-3 p-3 bg-surface-2 border border-border-strong rounded-[var(--radius-default)]"
          style={{ animation: "fadeIn 0.15s ease-out" }}
        >
          <p className="text-[10px] text-text-faint leading-relaxed">
            Every piece in this idea writes to this, unless it says otherwise.
          </p>
          <BriefField
            label="Goal"
            value={idea.goal ?? ""}
            onChange={(v) => updateIdea(ideaId, { goal: v })}
            placeholder="What is this idea trying to do?"
          />
          <BriefField
            label="Audience"
            value={idea.audience ?? ""}
            onChange={(v) => updateIdea(ideaId, { audience: v })}
            inherited={inherited.audience}
            voiceName={voice?.name}
            placeholder="Who is this for?"
          />
          <BriefField
            label="Tone"
            value={idea.tone ?? ""}
            onChange={(v) => updateIdea(ideaId, { tone: v })}
            inherited={inherited.tone}
            voiceName={voice?.name}
            placeholder="e.g. conversational, formal, witty…"
          />
          <BriefField
            label="Remember"
            value={idea.remember ?? ""}
            onChange={(v) => updateIdea(ideaId, { remember: v })}
            inherited={inherited.remember}
            voiceName={voice?.name}
            placeholder="Things the AI should always keep in mind…"
            rows={2}
          />
          {voicesList.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
                Voice
              </span>
              <select
                value={idea.voiceId ?? "__default__"}
                onChange={(e) => {
                  const v = e.target.value;
                  updateIdea(ideaId, { voiceId: v === "__default__" ? undefined : v });
                }}
                className="bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1
                  text-[12px] text-text-secondary outline-none focus:border-border-active"
              >
                <option value="__default__">
                  Default{defaultVoiceId && voicesMap[defaultVoiceId] ? ` (${voicesMap[defaultVoiceId].name})` : ""}
                </option>
                {voicesList.map((v) => (
                  <option key={v.id} value={v.id}>{v.name || "Untitled voice"}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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

/**
 * One long-form draft as a row: click to open it in the editor, right-click
 * for the same actions the hover Trash icon used to be the only route to.
 *
 * No pin here, unlike a piece. An idea has a handful of drafts and they are
 * already listed oldest-first by hand; a pin would be ceremony over a list
 * short enough to read at a glance.
 */
/**
 * Extract from one draft, from that draft's own menu.
 *
 * The panel button reads the whole idea, which is the right default and the
 * wrong answer when four drafts are open: pieces come back and you cannot tell
 * which draft each one came out of. Pointing at a row removes the question.
 */
function ExtractMenuItem({
  disabled,
  onExtract,
  onClose,
}: {
  disabled: boolean;
  onExtract: () => void;
  onClose: () => void;
}) {
  return (
    <ContextMenuItem
      label="Extract pieces from this draft"
      hint="Reads this draft only. What comes back waits in the inbox"
      disabled={disabled}
      onClick={() => {
        onClose();
        onExtract();
      }}
    />
  );
}

/**
 * Runs the idea extractor over everything in this idea.
 *
 * Sits above the pieces list rather than in a menu because it is the one
 * action here that reads the whole idea at once, and because what it produces
 * appears directly below it. The count of what came back is deliberately not
 * promised up front: how many pieces an idea contains is the question being
 * asked, not a setting.
 */
function ExtractButton({
  onExtract,
  isExtracting,
  activeLabel,
}: {
  onExtract: () => void;
  isExtracting: boolean;
  activeLabel: string | null;
}) {
  // The tip sits beside the button rather than inside it: a button inside a
  // button is invalid markup, and React says so at hydration.
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <button
        onClick={onExtract}
        disabled={isExtracting}
        title="Read the brief, every draft and every source in this idea, and pull out the parts that stand on their own. To read one draft on its own, right-click that draft"
        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-[var(--radius-sm)]
          border border-border bg-surface-2 text-[10px] text-text-muted
          hover:text-text-secondary hover:border-border-strong
          disabled:opacity-50 disabled:pointer-events-none transition-all duration-150"
      >
        <Sparkles size={10} />
        {isExtracting
          ? `Extracting from ${activeLabel ?? "this idea"}…`
          : "Extract from the whole idea"}
      </button>
    </div>
  );
}

function DraftRow({
  piece,
  isActive,
  onOpen,
  onRename,
  onMove,
  onExtract,
  extractDisabled,
  onArchive,
  onDelete,
}: {
  piece: ContentPiece;
  isActive: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onMove: (to: PanelSection) => void;
  onExtract: () => void;
  extractDisabled: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { point, openAt, close } = useContextMenu();
  const [renaming, setRenaming] = useState(false);
  const [marking, setMarking] = useState(false);
  const { onMouseDown, dragged } = useRowDrag(piece, "drafts", onMove);

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onClick={() => { if (!dragged.current) onOpen(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(); }}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={openAt}
      className={`group relative flex flex-col px-3 py-2 rounded-[var(--radius-default)] cursor-pointer transition-colors duration-150
        ${isActive ? "bg-surface-3" : "hover:bg-surface-2"}`}
    >
      {isActive && <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gold" />}
      <div className="flex items-center gap-2">
        <FileText size={11} className={`shrink-0 ${isActive ? "text-gold" : "text-text-faint"}`} />
        {renaming ? (
          <RenameInput
            seed={renameSeed(piece)}
            placeholder="Name this draft…"
            onCommit={(v) => { onRename(v); setRenaming(false); }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className={`flex-1 min-w-0 truncate text-[12px] ${isActive ? "text-text-primary" : "text-text-secondary"}`}>
            {pieceLabel(piece, "Untitled draft")}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete this draft"
          className="opacity-0 group-hover:opacity-100 p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-red hover:bg-red-muted transition-all duration-150"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {/* A published draft says so instead of showing a word count and a last-
          edited date. Both of those are about work in progress, and the one
          thing worth knowing from the list about a published draft is that its
          words are closed. */}
      {piece.status === "published" ? (
        <span
          title={
            piece.editedAfterPublishAt !== undefined
              ? "Published, and edited since. What is here no longer matches what went out."
              : "Published. Its words are closed. Open it to duplicate it or edit anyway."
          }
          className="pl-[19px] flex items-center gap-1 text-[10px] text-text-faint font-[family-name:var(--font-mono)]"
        >
          <Lock size={9} className="shrink-0" />
          {piece.editedAfterPublishAt !== undefined
            ? "published, edited since"
            : "this is published"}
          {piece.publish && ` · ${formatDate(piece.publish.publishedAt)}`}
        </span>
      ) : (
        <span className="pl-[19px] text-[10px] text-text-faint font-[family-name:var(--font-mono)]">
          {wordCount(piece.body)} words · {formatDate(piece.updatedAt)}
        </span>
      )}

      {point && (
        <ContextMenu point={point} onClose={close}>
          <ContextMenuItem label="Open in the editor" onClick={() => { close(); onOpen(); }} />
          <ContextMenuItem
            label="Rename"
            hint="The title the editor shows. Double-clicking the row does this too"
            onClick={() => { close(); setRenaming(true); }}
          />
          <ContextMenuDivider />
          <ExtractMenuItem disabled={extractDisabled} onExtract={onExtract} onClose={close} />
          <ContextMenuDivider />
          <MarkPublishedMenuSection
            piece={piece}
            onMark={() => { close(); setMarking(true); }}
          />
          <ContextMenuDivider />
          <PieceShapeItems piece={piece} onClose={close} />
          <ContextMenuDivider />
          <ContextMenuItem
            label="Archive"
            hint="Out of this idea's list. Nothing is deleted"
            onClick={() => { close(); onArchive(); }}
          />
          <ContextMenuItem
            label="Delete draft"
            destructive
            onClick={() => { close(); onDelete(); }}
          />
        </ContextMenu>
      )}

      {marking && (
        <MarkPublishedDialog piece={piece} onClose={() => setMarking(false)} />
      )}
    </div>
  );
}

/** One piece as a table-of-contents row: a pin if it has one, a status dot
 * (grey inbox, blue in progress, gold ready, green published), the plain-text
 * label, a priority flag, and the unseen pulse for anything an agent pushed
 * that you haven't looked at yet.
 *
 * Pin and priority are marks a writer sets and then needs to see from the
 * list, not from inside the piece: a pin you can only confirm by opening the
 * card is a pin you have to remember, which is the job it was meant to do for
 * you. The pin goes hard left, ahead of the status dot, since it is the one
 * thing that explains why this row is above the others.
 *
 * The row also mirrors the feed: whichever piece has roving focus over there
 * gets the gold rail here, and hovering a card lights up its row, so the panel
 * answers "where am I" without you having to find the highlighted card. */
function PieceRow({
  piece,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: {
  piece: ContentPiece;
  onOpen: () => void;
  onRename: (title: string) => void;
  onMove: (to: PanelSection) => void;
  onDelete: () => void;
}) {
  const focusedPieceId = useAppStore((s) => s.focusedPieceId);
  const hoveredPieceId = useAppStore((s) => s.hoveredPieceId);
  const setHoveredPiece = useAppStore((s) => s.setHoveredPiece);
  const isFocused = focusedPieceId === piece.id;
  const isHovered = hoveredPieceId === piece.id;
  const priority = priorityMeta(piece.priority);
  const { point, openAt, close } = useContextMenu();
  const [renaming, setRenaming] = useState(false);
  const [marking, setMarking] = useState(false);
  const { onMouseDown, dragged } = useRowDrag(piece, "pieces", onMove);

  return (
    <div
      role="button"
      tabIndex={0}
      onMouseDown={onMouseDown}
      onClick={() => { if (!dragged.current) onOpen(); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(); }}
      onDoubleClick={() => setRenaming(true)}
      onContextMenu={openAt}
      onMouseEnter={() => setHoveredPiece(piece.id)}
      onMouseLeave={() => setHoveredPiece(null)}
      title={[
        pieceLabel(piece),
        STATUS_WORD[piece.status],
        priority ? `${priority.label} priority` : null,
        piece.pinnedAt !== undefined ? "pinned" : null,
      ]
        .filter(Boolean)
        .join(" — ")}
      className={`relative flex items-center gap-2 px-3 py-2 rounded-[var(--radius-default)] cursor-pointer transition-colors duration-150 ${
        isFocused ? "bg-surface-3" : isHovered ? "bg-surface-2" : "hover:bg-surface-2"
      }`}
    >
      {isFocused && <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-gold" />}
      {piece.pinnedAt !== undefined && (
        <Pin size={9} fill="currentColor" className="shrink-0 text-gold" />
      )}
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[piece.status]}`} />
      {renaming ? (
        <RenameInput
          seed={renameSeed(piece)}
          placeholder="Name this piece…"
          onCommit={(v) => { onRename(v); setRenaming(false); }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span
          className={`flex-1 min-w-0 truncate text-[12px] ${isFocused ? "text-text-primary" : "text-text-muted"}`}
        >
          {pieceLabel(piece)}
        </span>
      )}
      {priority && <Flag size={9} fill="currentColor" className={`shrink-0 ${priority.className}`} />}

      {/* A single-line row has no room for the sentence, so the padlock carries
          it and the tooltip says it. The green status dot above already means
          "published"; this is the part that means "and therefore closed". */}
      {piece.status === "published" && (
        <span
          className="shrink-0 text-text-faint"
          title={
            piece.editedAfterPublishAt !== undefined
              ? "This is published, and edited since. What is here no longer matches what went out."
              : "This is published. Its words are closed."
          }
        >
          <Lock size={9} />
        </span>
      )}

      {!piece.seen && piece.origin === "agent" && (
        <span
          className="w-1.5 h-1.5 rounded-full bg-gold shrink-0"
          style={{ animation: "pulse-gold 2s ease-in-out infinite" }}
        />
      )}

      {point && (
        <ContextMenu point={point} onClose={close}>
          <ContextMenuItem label="Open in the feed" onClick={() => { close(); onOpen(); }} />
          <ContextMenuDivider />
          <MarkPublishedMenuSection
            piece={piece}
            onMark={() => { close(); setMarking(true); }}
          />
          <ContextMenuDivider />
          <PieceMenuItems
            piece={piece}
            onClose={close}
            onRename={() => setRenaming(true)}
            onDelete={onDelete}
          />
        </ContextMenu>
      )}

      {marking && (
        <MarkPublishedDialog piece={piece} onClose={() => setMarking(false)} />
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
