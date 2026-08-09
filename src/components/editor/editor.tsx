"use client";

import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";
import { TextSelection } from "@tiptap/pm/state";
import { CommentHighlight } from "@/lib/editor/comment-highlight-extension";
import { InsertHighlight } from "@/lib/editor/insert-highlight-extension";
import { isHistoryTransaction, undoDepth } from "@tiptap/pm/history";
import {
  PanelLeftOpen,
  PanelRightOpen,
  Clock,
  Undo2,
  Redo2,
  Check,
  Loader2,
  Square,
} from "lucide-react";
import { SlashBlockExtension } from "@/lib/slash-block-extension";
import { useAppStore } from "@/stores/app-store";
import { PieceCreationFlow, EmptyPieceActions, ContextFieldsTooltip } from "./piece-creation-flow";
import { PieceHeader } from "./piece-header";
import { ExportMenu } from "./export-menu";
import { CommentsAffordance } from "@/components/review/comments-affordance";
import { InlineEditMenu } from "./inline-edit-menu";
import { BriefField } from "./brief-field";
import { VersionPreviewBanner } from "../timeline/version-preview-banner";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { useBrief, voiceIdFor } from "@/hooks/use-brief";
import { inheritedBrief } from "@/lib/brief-context";
import { useToastStore } from "@/hooks/use-toast";
import { useContentStore } from "@/stores/content-store";
import { titleFromText } from "@/lib/derive-title";
import { useLabelSnippet } from "@/hooks/use-label-snippet";
import { useSlashCommand } from "@/hooks/use-slash-command";
import { useInlineEdit } from "@/hooks/use-inline-edit";
import { logApiCall } from "@/lib/api-logger";
import { postLabel } from "@/lib/ai-client";
import { isAiAuthFailureStatus, resolveWorkingFeatureAuth } from "@/lib/ai/connection-status";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";
import { debounce, generateId, type DebouncedFn } from "@/lib/utils";
import { preserveEmptyParagraphs } from "@/lib/publish/whitespace";
import { WhitespaceParagraph, WhitespaceText } from "@/lib/editor/whitespace-markdown";
import { useSaveStatus } from "@/hooks/use-save-status";
import { useStreamGeneration } from "@/hooks/use-stream-generation";
import { useGenerateTitle } from "@/hooks/use-generate-title";
import { PieceUsageFooter } from "./piece-usage-footer";
import type { Editor as TiptapEditor } from "@tiptap/core";

/**
 * After setContent parses NBSP-placeholder markdown, strip the \u00A0 from
 * those paragraphs so the editor sees truly empty paragraph nodes.
 */
function cleanupNbspParagraphs(ed: TiptapEditor) {
  const { state, view } = ed;
  const tr = state.tr;
  const targets: { from: number; to: number }[] = [];
  state.doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.textContent === "\u00A0") {
      targets.push({ from: pos + 1, to: pos + 1 + node.content.size });
    }
  });
  // Delete in reverse so positions stay valid
  for (let i = targets.length - 1; i >= 0; i--) {
    tr.delete(targets[i].from, targets[i].to);
  }
  if (tr.docChanged) {
    view.dispatch(tr);
  }
}


interface EditorProps {
  onOpenAISettings?: () => void;
  /** Rendered as the first item in the toolbar row (before the sidebar-toggle
   * button) — how app-shell.tsx places the ARI-154 Write/Pieces SpaceToggle
   * at the left of the center-panel toolbar when an idea is active, without
   * this file needing to know anything about ideas or the Content Engine. */
  leftToolbarSlot?: React.ReactNode;
}

export function Editor({ onOpenAISettings, leftToolbarSlot }: EditorProps) {
  const {
    activePieceId,
    sidebarOpen,
    helperBarOpen,
    timelineOpen,
    timelinePreviewVersionId,
    pendingSnippetDrop,
    showCreationFlow,
    contextPromptDismissedPieces,
    toggleSidebar,
    toggleHelperBar,
    toggleTimeline,
    setDraggingToHelper,
    setTimelinePreviewVersionId,
    setPendingSnippetDrop,
    commitPendingDrop,
    pendingEditorDeletion,
    setPendingEditorDeletion,
    setFloatingDragCard,
    updateFloatingCardLabel,
    setLiveEditorContent,
    generatingPieceId,
    streamingContent,
  } = useAppStore();
  const {
    versions,
    addSnippet,
    removeSnippet,
    restoreSnippet,
  } = useDataStore();
  const pieces = useContentStore((s) => s.pieces);
  const updatePiece = useContentStore((s) => s.updatePiece);
  const settings = useSettingsStore((s) => s.settings);
  const updateProviderCredentials = useSettingsStore((s) => s.updateProviderCredentials);
  const { labelSnippet } = useLabelSnippet();
  const { enabled: slashEnabled } = useSlashCommand();
  const { edit: inlineEdit, enabled: inlineEditEnabled } = useInlineEdit();
  const saveStatus = useSaveStatus();
  const { startGeneration, abort: abortGeneration } = useStreamGeneration();
  const { generateTitle, isGenerating: generatingTitle } = useGenerateTitle();
  const isGenerating = generatingPieceId === activePieceId && generatingPieceId !== null;

  const floatingLabelAbortRef = useRef<AbortController | null>(null);
  const dragClickPosRef = useRef<number | null>(null);
  const customDragRangeRef = useRef<{ from: number; to: number } | null>(null);
  // Stable refs for functions used inside Tiptap handleDOMEvents closures
  const prefetchLabelRef = useRef<((text: string, signal: AbortSignal) => Promise<void>) | null>(null);
  const labelSnippetRef = useRef(labelSnippet);
  // The resolved goal, for the drag closure below: it cannot read the piece's
  // own goal off the store and get the right answer any more, because the goal
  // may be inherited from the idea.
  const briefGoalRef = useRef("");
  // Refs for snippet undo/redo tracking
  const editorRef = useRef<TiptapEditor | null>(null);
  const snippetInsertMapRef = useRef<Map<number, import("@/lib/types").Snippet>>(new Map());
  const snippetRemoveMapRef = useRef<Map<number, import("@/lib/types").Snippet>>(new Map());
  const prevUndoDepthRef = useRef(0);
  const pendingSnippetRecordRef = useRef<{ snapshot: import("@/lib/types").Snippet; isOutward?: boolean } | null>(null);
  // Timers fading out an insert-highlight decoration (see
  // insert-highlight-extension.ts). Tracked so unmount can clear them instead
  // of firing a command against a destroyed editor.
  const insertHighlightTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const isCancellingDropRef = useRef(false);

  const piece = activePieceId ? pieces[activePieceId] : null;
  const previewVersion = timelinePreviewVersionId ? versions[timelinePreviewVersionId] ?? null : null;
  const voicesMap = useVoiceStore((s) => s.voices);
  const voicesList = useMemo(
    () => Object.values(voicesMap).sort((a, b) => a.createdAt - b.createdAt),
    [voicesMap],
  );
  // Voice and brief resolve together, fragment → idea → voice, so what the
  // toolbar shows greyed is exactly what the model is sent. See use-brief.ts.
  const { brief, voice: resolvedVoice, idea: pieceIdea } = useBrief(piece);
  const resolvedVoiceId = voiceIdFor(piece, pieceIdea);
  const resolvedBrief = useMemo(
    () => ({
      goal: brief.goal.value,
      audience: brief.audience.value,
      tone: brief.tone.value,
      remember: brief.remember.value,
    }),
    [brief],
  );
  const inherited = useMemo(
    () => inheritedBrief("fragment", { piece, idea: pieceIdea, voice: resolvedVoice }),
    [piece, pieceIdea, resolvedVoice],
  );
  const contentRef = useRef<string | null>(null);
  const isInternalUpdate = useRef(false);

  // Goal overlay state
  const [goalOpen, setGoalOpen] = useState(false);
  const goalCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openGoal = () => {
    if (goalCloseTimer.current) clearTimeout(goalCloseTimer.current);
    setGoalOpen(true);
  };
  const closeGoal = () => {
    goalCloseTimer.current = setTimeout(() => setGoalOpen(false), 150);
  };

  const editorScrollRef = useRef<HTMLDivElement>(null);
  const wasPreviewingRef = useRef(false);
  const lastPreviewVersionIdRef = useRef<string | null>(null);

  const debouncedSave = useMemo(
    () =>
      debounce((id: string, content: string) => {
        updatePiece(id, { body: content });
      }, 500) as DebouncedFn<(id: string, content: string) => void>,
    [updatePiece],
  );

  const editor = useEditor({
    extensions: [
      // paragraph/text come from WhitespaceParagraph/WhitespaceText instead, so
      // the markdown serializer stops discarding empty paragraphs and space
      // runs on every save (see lib/editor/whitespace-markdown.ts).
      StarterKit.configure({
        dropcursor: {
          color: "#f0c446",
          width: 2,
        },
        link: false,
        paragraph: false,
        text: false,
      }),
      WhitespaceParagraph,
      WhitespaceText,
      Placeholder.configure({
        placeholder: "Start writing...",
      }),
      Typography,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: "text-gold underline underline-offset-2",
        },
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true,
      }),
      SlashBlockExtension,
      CommentHighlight,
      InsertHighlight,
    ],
    editorProps: {
      attributes: {
        class: "tiptap-editor",
      },
      handleDOMEvents: {
        mousedown: (view, event) => {
          // Only handle left-click on existing text selection
          if (event.button !== 0) return false;
          const { from, to } = view.state.selection;
          if (from === to) return false;
          const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
          if (!pos || pos.pos < from || pos.pos > to) return false;

          dragClickPosRef.current = pos.pos;

          // Pending-return drag: let native DnD handle it (no preventDefault)
          const pending = useAppStore.getState().pendingSnippetDrop;
          if (pending && !pending.cancelled) {
            if (from < pending.editorTo && to > pending.editorFrom) {
              return true;
            }
          }

          // ── Custom mouse-based drag (replaces HTML5 DnD) ──
          // Prevents native text drag ghost that WebKit/Tauri can't override.
          // Two destinations: the Snip Bar (cut the passage out into a snip)
          // and the draft itself (move the passage to where you dropped it).
          // Anywhere else, and Escape, cancel: nothing is dispatched, so the
          // text is exactly where it started and there is nothing to undo.
          event.preventDefault();

          const startX = event.clientX;
          const startY = event.clientY;
          let dragging = false;
          let labelRequested = false;

          /** The Snip Bar drop zone if the pointer is over it, else null. */
          const snipBarUnder = (clientX: number, clientY: number) => {
            const dropZone = document.querySelector("[data-snip-bar-drop-zone]");
            if (!dropZone) return null;
            const el = document.elementFromPoint(clientX, clientY);
            return dropZone.contains(el) || el === dropZone ? dropZone : null;
          };

          const onMove = (e: MouseEvent) => {
            if (!dragging) {
              if (Math.hypot(e.clientX - startX, e.clientY - startY) < 5) return;
              dragging = true;
              dragClickPosRef.current = null;

              const txt = view.state.doc.textBetween(from, to, "\n");
              if (!txt.trim()) { cleanup(); return; }

              customDragRangeRef.current = { from, to };
              useAppStore.getState().setDraggingToHelper(true);
              // "idle", not "loading": a label only means something for a snip,
              // and this drag may well end as a move within the draft.
              useAppStore.getState().setFloatingDragCard({
                content: txt, label: null, labelStatus: "idle",
              });
              view.dom.classList.add("is-snippet-dragging-out");
            }

            // Labelling starts the moment the passage is over the Snip Bar, so
            // the label is usually ready by the time it is dropped, without
            // spending a call on every passage the writer merely moves.
            if (!labelRequested && snipBarUnder(e.clientX, e.clientY)) {
              labelRequested = true;
              const dragged = useAppStore.getState().floatingDragCard;
              if (dragged) {
                useAppStore.getState().updateFloatingCardLabel(null, "loading");
                floatingLabelAbortRef.current?.abort();
                floatingLabelAbortRef.current = new AbortController();
                prefetchLabelRef.current?.(dragged.content, floatingLabelAbortRef.current.signal);
              }
            }

            // Position floating card directly on the DOM (no React re-renders)
            const card = document.querySelector("[data-floating-card]") as HTMLElement | null;
            if (card) {
              card.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`;
              card.style.opacity = "1";
            }
          };

          const cleanup = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            document.removeEventListener("keydown", onKeyDown, true);
          };

          /** Drop every trace of the drag. Shared by all four exits (snip,
           * move, drop-outside, Escape) so no two of them can disagree. */
          const teardown = () => {
            customDragRangeRef.current = null;
            useAppStore.getState().setDraggingToHelper(false);
            floatingLabelAbortRef.current?.abort();
            useAppStore.getState().setFloatingDragCard(null);
            view.dom.classList.remove("is-snippet-dragging-out");
          };

          const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            cleanup();
            if (dragging) teardown();
          };

          /** Move the dragged passage to the drop point. One transaction, so
           * one undo puts the draft back the way it was. */
          const moveWithinDraft = (clientX: number, clientY: number) => {
            const range = customDragRangeRef.current;
            const scrollEl = editorScrollRef.current;
            if (!range || !scrollEl) return;

            // Dropped outside the writing surface → cancel, leave the text be.
            const el = document.elementFromPoint(clientX, clientY);
            if (!el || !scrollEl.contains(el)) return;

            const target = view.posAtCoords({ left: clientX, top: clientY });
            if (!target) return;

            const { state } = view;
            const docSize = state.doc.content.size;
            const sf = Math.min(range.from, docSize);
            const st = Math.min(range.to, docSize);
            if (sf >= st) return;

            // Dropped back onto itself: a no-op, not a delete-and-reinsert.
            const at = target.pos;
            if (at >= sf && at <= st) return;

            // Move the slice, not the text, so marks and block structure survive.
            const slice = state.doc.slice(sf, st);
            const tr = state.tr;
            tr.delete(sf, st);
            const insertAt = tr.mapping.map(at);
            const sizeBefore = tr.doc.content.size;
            tr.replaceRange(insertAt, insertAt, slice);
            const inserted = tr.doc.content.size - sizeBefore;

            // Leave the passage selected where it landed, so it can be moved
            // again or acted on from the selection toolbar.
            if (inserted > 0) {
              try {
                const end = Math.min(insertAt + inserted, tr.doc.content.size);
                tr.setSelection(
                  TextSelection.between(tr.doc.resolve(insertAt), tr.doc.resolve(end)),
                );
              } catch {
                // Selection is a nicety; the move itself already succeeded.
              }
            }

            view.dispatch(tr);
            view.focus();
          };

          const onUp = (e: MouseEvent) => {
            cleanup();

            if (dragging) {
              // Check if mouse is over the Snip Bar drop zone
              const dropZone = snipBarUnder(e.clientX, e.clientY);

              if (dropZone) {
                const range = customDragRangeRef.current;
                const pieceId = useAppStore.getState().activePieceId;
                const card = useAppStore.getState().floatingDragCard;
                if (range && pieceId && card) {
                  const idxAttr = dropZone.getAttribute("data-drop-index");
                  const dropIdx = idxAttr ? parseInt(idxAttr, 10) : undefined;
                  // Tagged with the open idea as well as the fragment, so the
                  // parts you cut off a draft are still in the bar when you
                  // cross to that idea's pieces (see lib/snip-scope.ts).
                  const snippetId = useDataStore.getState().addSnippet(
                    pieceId, card.content,
                    Number.isFinite(dropIdx) ? dropIdx : undefined,
                    useAppStore.getState().activeIdeaId ?? undefined,
                  );

                  // Build snippet snapshot for undo tracking
                  const createdSnippet = useDataStore.getState().snippets[snippetId];
                  if (createdSnippet) {
                    pendingSnippetRecordRef.current = { snapshot: { ...createdSnippet }, isOutward: true };
                  }

                  // Delete source text from editor (this transaction triggers onUpdate
                  // which records the snippet in snippetRemoveMapRef for undo)
                  const tr = view.state.tr;
                  const docSize = tr.doc.content.size;
                  const sf = Math.min(range.from, docSize);
                  const st = Math.min(range.to, docSize);
                  if (sf < st) { tr.delete(sf, st); view.dispatch(tr); }

                  // Apply label
                  if (card.labelStatus === "done" && card.label) {
                    useDataStore.getState().updateSnippetLabel(snippetId, card.label, "done");
                  } else {
                    const source = useContentStore.getState().pieces[pieceId];
                    if (source) {
                      labelSnippetRef.current(snippetId, card.content, source.body, briefGoalRef.current, pieceId);
                    }
                  }

                  // Keep the Snip Bar open after a successful drop
                  useAppStore.getState().pinHelperBar();
                }
              } else {
                moveWithinDraft(e.clientX, e.clientY);
              }

              teardown();
            }
            // Click-only (no drag): Tiptap mouseup handler places cursor
          };

          document.addEventListener("mousemove", onMove);
          document.addEventListener("mouseup", onUp);
          document.addEventListener("keydown", onKeyDown, true);
          return true;
        },
        mouseup: (view, event) => {
          // Handle click on selected text (no drag occurred)
          if (dragClickPosRef.current !== null) {
            dragClickPosRef.current = null;
            const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (pos) {
              const { tr } = view.state;
              tr.setSelection(TextSelection.create(tr.doc, pos.pos));
              view.dispatch(tr);
            }
            return true;
          }
          return false;
        },
        dragstart: () => {
          // Only fires for pending-return drags (native DnD).
          // Custom drag prevented native drag via preventDefault in mousedown.
          dragClickPosRef.current = null;
          return false;
        },
      },
      handleKeyDown: (_view, event) => {
        // Intercept "/" at the start of an empty line or beginning of a line
        if (event.key === "/" && slashEnabled) {
          const { state } = _view;
          const { $from } = state.selection;
          const isEmptyLine = $from.parent.textContent === "";
          const isStartOfLine = $from.parentOffset === 0;

          if (isEmptyLine || isStartOfLine) {
            const slashBlockType = state.schema.nodes.slashBlock;
            if (!slashBlockType) return false;

            event.preventDefault();

            const paraStart = $from.before($from.depth);
            const paraEnd = $from.after($from.depth);
            const tr = state.tr;

            if (isEmptyLine) {
              // Replace the empty paragraph with the slash block
              tr.replaceWith(
                paraStart,
                paraEnd,
                slashBlockType.create({ replacedEmpty: true }),
              );
            } else {
              // Insert the slash block before the current non-empty paragraph
              tr.insert(
                paraStart,
                slashBlockType.create({ replacedEmpty: false }),
              );
            }

            // Suppress save while this transient node is in the document
            isInternalUpdate.current = true;
            _view.dispatch(tr);
            isInternalUpdate.current = false;
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event) => {
        const snippetData = event.dataTransfer?.getData(
          "application/x-fragment-insert",
        );
        if (!snippetData) return false;

        event.preventDefault();
        const dropPos = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        if (!dropPos) return false;

        const editorInstance = editorRef.current;
        if (!editorInstance) return false;

        try {
          const { content, id } = JSON.parse(snippetData) as { content: string; id: string };
          const snippetObj = useDataStore.getState().snippets[id];

          // Build proper node structure: one paragraph per line
          // This ensures newlines create real paragraph breaks, not invisible \n chars
          const lines = content.split("\n");
          const contentNodes = lines.map((line) => ({
            type: "paragraph" as const,
            content: line.length > 0 ? [{ type: "text" as const, text: line }] : [],
          }));

          const sizeBefore = editorInstance.state.doc.content.size;

          // Tag this update so onUpdate can record it for undo tracking
          if (snippetObj) {
            pendingSnippetRecordRef.current = { snapshot: { ...snippetObj } };
          }

          // Insert via Tiptap's insertContentAt which correctly handles
          // multi-paragraph content at any document position
          editorInstance.chain().insertContentAt(dropPos.pos, contentNodes).run();

          const sizeAfter = editorInstance.state.doc.content.size;
          const insertedSize = sizeAfter - sizeBefore;

          // Approximate range for the pending-drop highlight and cancel-undo
          const from = dropPos.pos;
          const to = Math.min(from + Math.max(insertedSize, 1), sizeAfter - 1);

          // Remove snippet from helper bar and track as pending (undoable)
          if (snippetObj) {
            removeSnippet(id);
            setPendingSnippetDrop({
              snippet: { ...snippetObj },
              editorFrom: from,
              editorTo: to,
              cancelled: false,
            });
          }

          // Reset drag state (snippet card may unmount before its dragend fires)
          useAppStore.getState().setDraggingToEditor(false);

          // Focus the editor so the selection highlight is visible
          setTimeout(() => view.focus(), 0);
        } catch {
          pendingSnippetRecordRef.current = null;
          return false;
        }

        setDraggingToHelper(false);
        return true;
      },
    },
    onSelectionUpdate: () => {
      // If there's a pending snippet drop and user clicked elsewhere, commit it
      const pending = useAppStore.getState().pendingSnippetDrop;
      if (!pending || pending.cancelled) return;
      // Check if selection still covers the pending range (user might be re-selecting)
      // We commit when the selection has fully moved away
      const { from, to } = editor?.state.selection ?? { from: 0, to: 0 };
      const overlaps = from < pending.editorTo && to > pending.editorFrom;
      if (!overlaps) {
        commitPendingDrop();
      }
    },
    onUpdate: ({ editor: ed, transaction }) => {
      if (isInternalUpdate.current) return;

      const currentUD = undoDepth(ed.state);
      const prevUD = prevUndoDepthRef.current;

      if (isHistoryTransaction(transaction)) {
        // Undo or redo — sync snippet state with editor history
        if (currentUD < prevUD) {
          // UNDO: reverse the step at depth prevUD
          if (!isCancellingDropRef.current) {
            // Restore snippet that was removed by a snippet-drop
            const inserted = snippetInsertMapRef.current.get(prevUD);
            if (inserted) restoreSnippet(inserted);
            // Remove snippet that was created by a text-to-snippet drag
            const removed = snippetRemoveMapRef.current.get(prevUD);
            if (removed) removeSnippet(removed.id);
          }
          isCancellingDropRef.current = false;
        } else if (currentUD > prevUD) {
          // REDO: re-apply the step at depth currentUD
          const inserted = snippetInsertMapRef.current.get(currentUD);
          if (inserted) removeSnippet(inserted.id);
          const removed = snippetRemoveMapRef.current.get(currentUD);
          if (removed) restoreSnippet(removed);
        }
        // Clear pending-drop visual state on any history event
        const pending = useAppStore.getState().pendingSnippetDrop;
        if (pending && !pending.cancelled) commitPendingDrop();
      } else {
        // Normal edit — commit pending drop and invalidate redo snippet entries
        const pending = useAppStore.getState().pendingSnippetDrop;
        if (pending && !pending.cancelled) commitPendingDrop();

        // Any new edit after an undo clears the redo stack; prune stale entries
        for (const depth of snippetInsertMapRef.current.keys()) {
          if (depth > currentUD) snippetInsertMapRef.current.delete(depth);
        }
        for (const depth of snippetRemoveMapRef.current.keys()) {
          if (depth > currentUD) snippetRemoveMapRef.current.delete(depth);
        }
      }

      // Record a snippet drop or text-to-snippet operation for future undo/redo
      if (pendingSnippetRecordRef.current) {
        const { snapshot, isOutward } = pendingSnippetRecordRef.current;
        if (isOutward) {
          snippetRemoveMapRef.current.set(currentUD, snapshot);
        } else {
          snippetInsertMapRef.current.set(currentUD, snapshot);
        }
        pendingSnippetRecordRef.current = null;
      }

      prevUndoDepthRef.current = currentUD;

      // Skip serialization while a transient slashBlock node is in the document
      // (the markdown serializer doesn't know how to handle it)
      let hasSlashBlock = false;
      ed.state.doc.descendants((n) => {
        if (n.type.name === "slashBlock") { hasSlashBlock = true; return false; }
        return true;
      });
      if (hasSlashBlock) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rawMd = (ed.storage as any).markdown.getMarkdown();
      const md = preserveEmptyParagraphs(rawMd);
      contentRef.current = md;
      const currentPieceId = useAppStore.getState().activePieceId;
      if (currentPieceId) {
        setLiveEditorContent(currentPieceId, md);
        debouncedSave(currentPieceId, md);
        // Synchronous backup, which survives any crash or refresh regardless of
        // debounce timing.
        try { localStorage.setItem(`fragment:editor:${currentPieceId}`, md); } catch {}
      }
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor || !piece) return;

    // Flush any pending debounced save so the previous fragment's text is persisted
    debouncedSave.flush();

    if (contentRef.current === piece.body) return;

    // Check for immediate localStorage backup that may be newer than DB
    let content = piece.body;
    try {
      const backup = localStorage.getItem(`fragment:editor:${piece.id}`);
      if (backup && backup.length > content.length) {
        content = backup;
      }
    } catch {}

    isInternalUpdate.current = true;
    editor.commands.setContent(content || "");
    cleanupNbspParagraphs(editor);
    contentRef.current = content;
    setLiveEditorContent(piece.id, content);
    isInternalUpdate.current = false;

    // Sync recovered content back to the store if it came from backup
    if (content !== piece.body) {
      updatePiece(piece.id, { body: content });
    }
  }, [editor, piece?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle version preview mode.
  // Do not re-set content on every versions-map mutation (e.g. saving snapshots),
  // otherwise unsaved spacing can be normalized away.
  useEffect(() => {
    if (!editor || !piece) return;

    if (timelinePreviewVersionId) {
      const version = versions[timelinePreviewVersionId];
      if (version) {
        editor.setEditable(false);
        const isSamePreview = lastPreviewVersionIdRef.current === version.id;
        if (!wasPreviewingRef.current || !isSamePreview) {
          isInternalUpdate.current = true;
          editor.commands.setContent(version.content || "");
          cleanupNbspParagraphs(editor);
          isInternalUpdate.current = false;
          lastPreviewVersionIdRef.current = version.id;
        }
        wasPreviewingRef.current = true;
      }
    } else {
      if (wasPreviewingRef.current) {
        editor.setEditable(true);
        isInternalUpdate.current = true;
        editor.commands.setContent(piece.body || "");
        cleanupNbspParagraphs(editor);
        contentRef.current = piece.body;
        setLiveEditorContent(piece.id, piece.body);
        isInternalUpdate.current = false;
      }
      wasPreviewingRef.current = false;
      lastPreviewVersionIdRef.current = null;
    }
  }, [editor, timelinePreviewVersionId, versions, piece, setLiveEditorContent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stream AI-generated content into the editor in real time
  useEffect(() => {
    if (!editor || streamingContent === null || generatingPieceId !== activePieceId) return;

    isInternalUpdate.current = true;
    editor.commands.setContent(streamingContent);
    cleanupNbspParagraphs(editor);
    contentRef.current = streamingContent;
    isInternalUpdate.current = false;

    // Keep liveEditorContent in sync so micro-save and flushAll
    // don't overwrite the fragment with stale/empty content
    if (activePieceId) {
      setLiveEditorContent(activePieceId, streamingContent);
    }

    // Pin scroll to top so user sees the first tokens
    if (editorScrollRef.current) {
      editorScrollRef.current.scrollTop = 0;
    }
  }, [editor, streamingContent, generatingPieceId, activePieceId, setLiveEditorContent]);

  // Toggle editor editability during streaming generation
  useEffect(() => {
    if (!editor) return;
    if (isGenerating) {
      editor.setEditable(false);
    } else if (!timelinePreviewVersionId) {
      editor.setEditable(true);
    }
  }, [editor, isGenerating, timelinePreviewVersionId]);

  // If user navigates away during generation, abort and persist partial content
  useEffect(() => {
    if (generatingPieceId && activePieceId !== generatingPieceId) {
      abortGeneration();
    }
  }, [activePieceId, generatingPieceId, abortGeneration]);

  // Toggle visual class on editor for pending drop highlight
  useEffect(() => {
    if (!editor) return;
    const el = editor.view.dom;
    if (pendingSnippetDrop && !pendingSnippetDrop.cancelled) {
      el.classList.add("has-pending-drop");
    } else {
      el.classList.remove("has-pending-drop");
    }
  }, [editor, pendingSnippetDrop]);

  // Keep editorRef in sync so handleDrop (a ProseMirror callback) can access the instance
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Handle pending snippet drop cancellation (drag-back to helper bar)
  // Uses ProseMirror undo so exact byte positions are not required
  useEffect(() => {
    if (!pendingSnippetDrop || !pendingSnippetDrop.cancelled || !editor) return;

    // Signal onUpdate's undo handler to skip the automatic snippet restore
    // because we do it explicitly here
    isCancellingDropRef.current = true;
    const undid = editor.commands.undo();
    if (!undid) {
      // Nothing to undo — reset flag so future undos work correctly
      isCancellingDropRef.current = false;
    }

    restoreSnippet(pendingSnippetDrop.snippet);
    setPendingSnippetDrop(null);
  }, [pendingSnippetDrop?.cancelled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Delete text from editor when it was dragged to snippets
  useEffect(() => {
    if (!pendingEditorDeletion || !editor) return;

    const { from, to, snippetId } = pendingEditorDeletion;

    // Tag for undo tracking: undoing this deletion should remove the created snippet
    if (snippetId) {
      const snippet = useDataStore.getState().snippets[snippetId];
      if (snippet) {
        pendingSnippetRecordRef.current = { snapshot: { ...snippet }, isOutward: true };
      }
    }

    const { tr } = editor.state;
    const docSize = editor.state.doc.content.size;
    const safeFrom = Math.min(from, docSize);
    const safeTo = Math.min(to, docSize);
    if (safeFrom < safeTo) {
      tr.delete(safeFrom, safeTo);
      editor.view.dispatch(tr);
    }
    setPendingEditorDeletion(null);
  }, [pendingEditorDeletion]); // eslint-disable-line react-hooks/exhaustive-deps

  // Process snippet→editor insertion from custom mouse drag.
  // The snippet card sets pendingSnippetInsert in the store; the editor picks it up here.
  const pendingSnippetInsert = useAppStore((s) => s.pendingSnippetInsert);
  useEffect(() => {
    if (!pendingSnippetInsert || !editor) return;
    const { snippetId, content, clientX, clientY } = pendingSnippetInsert;
    useAppStore.getState().setPendingSnippetInsert(null);

    // A card dropped on the page carries the coordinates it landed at. The
    // Snip Bar's own "insert into draft" action carries none, and means the
    // cursor: it never touched the document to name a position.
    const dropPos =
      clientX === undefined || clientY === undefined
        ? { pos: editor.state.selection.from }
        : editor.view.posAtCoords({ left: clientX, top: clientY });
    if (!dropPos) return;

    const lines = content.split("\n");
    const contentNodes = lines.map((line) => ({
      type: "paragraph" as const,
      content: line.length > 0 ? [{ type: "text" as const, text: line }] : [],
    }));

    // Null for text dragged in from a piece rather than a snip: it is a copy,
    // so nothing is consumed and no undo pairing is recorded.
    const snippetObj = snippetId ? useDataStore.getState().snippets[snippetId] : undefined;
    if (snippetObj) {
      pendingSnippetRecordRef.current = { snapshot: { ...snippetObj } };
    }

    const sizeBefore = editor.state.doc.content.size;
    editor.chain().insertContentAt(dropPos.pos, contentNodes).run();
    const sizeAfter = editor.state.doc.content.size;
    const insertedSize = sizeAfter - sizeBefore;
    const from = dropPos.pos;
    const to = Math.min(from + Math.max(insertedSize, 1), sizeAfter - 1);

    if (snippetObj && snippetId) {
      removeSnippet(snippetId);
      setPendingSnippetDrop({
        snippet: { ...snippetObj },
        editorFrom: from,
        editorTo: to,
        cancelled: false,
      });
    }

    // Spotlight the region that just landed so the writer can see exactly
    // what came in, then let it fade. It is a decoration, never a mark, so it
    // never reaches saved markdown (see insert-highlight-extension.ts).
    const highlightId = generateId();
    editor.commands.addInsertHighlight({ id: highlightId, from, to });
    const timer = setTimeout(() => {
      insertHighlightTimersRef.current.delete(highlightId);
      if (!editor.isDestroyed) editor.commands.removeInsertHighlight(highlightId);
    }, 5000);
    insertHighlightTimersRef.current.set(highlightId, timer);

    setTimeout(() => editor.view.focus(), 0);
  }, [pendingSnippetInsert, editor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear any still-pending insert-highlight fade timers on unmount, so they
  // never fire a command against an editor that is already gone.
  useEffect(() => {
    const timers = insertHighlightTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Show a drop indicator in the editor while something is being dragged over
  // it: a snippet coming in from the bar, or a passage being moved within the
  // draft (both land at a position, so both want the same caret).
  // Two modes:
  //   • Between blocks (paragraph boundaries) → horizontal gold line centered in the gap
  //   • Inside text (mid-paragraph) → thin vertical gold caret
  const isDraggingSnippetIn = useAppStore((s) => s.isDraggingToEditor);
  const isDraggingOut = useAppStore((s) => s.isDraggingToHelper);
  useEffect(() => {
    if ((!isDraggingSnippetIn && !isDraggingOut) || !editor) return;
    const scrollEl = editorScrollRef.current;
    if (!scrollEl) return;

    let lineEl: HTMLDivElement | null = null;   // horizontal between-block indicator
    let caretEl: HTMLDivElement | null = null;   // vertical in-text caret

    const ensureLine = () => {
      if (lineEl) return lineEl;
      lineEl = document.createElement("div");
      lineEl.style.cssText =
        "position:absolute;left:2rem;right:2rem;height:2px;background:var(--color-gold);border-radius:1px;pointer-events:none;z-index:10;display:none;";
      scrollEl.appendChild(lineEl);
      return lineEl;
    };

    const ensureCaret = () => {
      if (caretEl) return caretEl;
      caretEl = document.createElement("div");
      caretEl.style.cssText =
        "position:absolute;width:2px;background:var(--color-gold);border-radius:1px;pointer-events:none;z-index:10;display:none;";
      scrollEl.appendChild(caretEl);
      return caretEl;
    };

    const hideAll = () => {
      if (lineEl) lineEl.style.display = "none";
      if (caretEl) caretEl.style.display = "none";
    };

    const onMove = (e: MouseEvent) => {
      const scrollRect = scrollEl.getBoundingClientRect();
      const isOver =
        e.clientX >= scrollRect.left && e.clientX <= scrollRect.right &&
        e.clientY >= scrollRect.top && e.clientY <= scrollRect.bottom;

      if (!isOver) { hideAll(); return; }

      const pos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!pos) { hideAll(); return; }

      // Resolve the document position to find out if we're at a block boundary
      const $pos = editor.state.doc.resolve(pos.pos);
      const atBlockBoundary =
        $pos.parentOffset === 0 ||                              // start of block
        $pos.parentOffset === $pos.parent.content.size;         // end of block

      const coords = editor.view.coordsAtPos(pos.pos);
      const offsetY = scrollEl.scrollTop - scrollRect.top;

      if (atBlockBoundary && $pos.parentOffset === 0) {
        // Between-block mode: horizontal line centered between the previous block's
        // bottom and this block's top.
        const blockTop = coords.top;
        let gapCenter: number;

        if (pos.pos > 1) {
          // Get the bottom of the preceding position
          const prevCoords = editor.view.coordsAtPos(pos.pos - 1);
          gapCenter = (prevCoords.bottom + blockTop) / 2;
        } else {
          gapCenter = blockTop;
        }

        const line = ensureLine();
        line.style.top = `${gapCenter + offsetY}px`;
        line.style.display = "";
        if (caretEl) caretEl.style.display = "none";
      } else {
        // In-text mode: vertical caret
        const caret = ensureCaret();
        const lineHeight = coords.bottom - coords.top;
        caret.style.top = `${coords.top + offsetY}px`;
        caret.style.left = `${coords.left - scrollRect.left}px`;
        caret.style.height = `${lineHeight}px`;
        caret.style.display = "";
        if (lineEl) lineEl.style.display = "none";
      }
    };

    document.addEventListener("mousemove", onMove);
    return () => {
      document.removeEventListener("mousemove", onMove);
      if (lineEl) lineEl.remove();
      if (caretEl) caretEl.remove();
    };
  }, [isDraggingSnippetIn, isDraggingOut, editor]);

  // Auto-scroll editor when dragging near edges. Listens to mousemove as well
  // as dragover: the editor→snippet and move-within-the-draft gestures are
  // hand-rolled mouse drags, so no dragover ever fires for them and without
  // this you cannot move a passage past the visible window.
  useEffect(() => {
    if (!isDraggingOut && !isDraggingSnippetIn) return;

    const nudge = (clientY: number) => {
      if (editorScrollRef.current) {
        const rect = editorScrollRef.current.getBoundingClientRect();
        const SCROLL_ZONE = 60;
        const SCROLL_SPEED = 8;
        if (clientY < rect.top + SCROLL_ZONE) {
          editorScrollRef.current.scrollTop -= SCROLL_SPEED;
        } else if (clientY > rect.bottom - SCROLL_ZONE) {
          editorScrollRef.current.scrollTop += SCROLL_SPEED;
        }
      }
    };

    const handleDragOver = (e: DragEvent) => nudge(e.clientY);
    const handleMouseMove = (e: MouseEvent) => nudge(e.clientY);

    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("mousemove", handleMouseMove);
    return () => {
      document.removeEventListener("dragover", handleDragOver);
      document.removeEventListener("mousemove", handleMouseMove);
    };
  }, [isDraggingOut, isDraggingSnippetIn]);


  const handleAddToSnippets = useCallback(() => {
    if (!editor || !activePieceId || !piece) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;

    const selectedText = editor.state.doc.textBetween(from, to, "\n");
    if (!selectedText.trim()) return;

    const snippetId = addSnippet(
      activePieceId,
      selectedText,
      undefined,
      useAppStore.getState().activeIdeaId ?? undefined,
    );
    if (!snippetId) return;
    labelSnippet(snippetId, selectedText, piece.body, resolvedBrief.goal, activePieceId);

    // Remove the snipped text from the editor
    editor.chain().focus().deleteRange({ from, to }).run();

    if (!helperBarOpen) toggleHelperBar();
  }, [
    editor,
    activePieceId,
    piece,
    addSnippet,
    labelSnippet,
    helperBarOpen,
    toggleHelperBar,
  ]);

  /**
   * Turn a highlighted passage into an idea of its own.
   *
   * Deliberately non-destructive, which is what separates this from Snip. A
   * tangent that occurs to you mid-paragraph is not something you want to cut;
   * you want it filed so you can keep going. The draft is left exactly as it
   * was, and the toast offers the jump rather than taking it, because being
   * moved somewhere else is the opposite of what capture is for.
   */
  const handleCaptureIdea = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const content = useContentStore.getState();
    if (!content.hydrated) return;

    const title = titleFromText(trimmed) || "Untitled idea";
    const ideaId = content.createIdea({ title, origin: "user" });
    if (!ideaId) return;

    content.createPiece({
      ideaId,
      format: "other",
      origin: "user",
      // Captured by you, mid-sentence, out of your own draft. Parking a
      // thought is not the same as receiving one, so it is not inbox work.
      status: "in-progress",
      body: trimmed,
      seen: true,
    });

    useToastStore.getState().showToast(`Idea created: ${title}`, {
      label: "Open",
      onClick: () => useAppStore.getState().setActiveIdea(ideaId),
    });
  }, []);

  const handleInlineEdit = useCallback(
    async (instruction: string): Promise<string | null> => {
      if (!editor || !piece || !inlineEditEnabled) return null;
      const { from, to } = editor.state.selection;
      if (from === to) return null;

      const selectedText = editor.state.doc.textBetween(from, to, "\n");
      if (!selectedText.trim()) return null;

      // Extract context before and after the selection from the full document
      const fullText = editor.state.doc.textBetween(0, editor.state.doc.content.size, "\n");
      const plainBefore = editor.state.doc.textBetween(0, from, "\n");
      const plainAfter = editor.state.doc.textBetween(to, editor.state.doc.content.size, "\n");

      // Use full document context to be smarter about edits
      void fullText;

      return inlineEdit(
        selectedText,
        plainBefore,
        plainAfter,
        resolvedBrief.goal,
        resolvedBrief.audience,
        resolvedBrief.tone,
        resolvedBrief.remember,
        instruction,
        activePieceId ?? undefined,
        resolvedVoiceId,
      );
    },
    [editor, piece, resolvedBrief, resolvedVoiceId, inlineEdit, inlineEditEnabled],
  );

  // Prefetch a label for the floating drag card
  const prefetchLabel = useCallback(
    async (content: string, signal: AbortSignal) => {
      if (!settings.snippetLabeling.enabled) {
        updateFloatingCardLabel(null, "idle" as "done");
        return;
      }
      try {
        const app = useAppStore.getState();
        const auth = resolveWorkingFeatureAuth(settings, app.badProviders, "snippetLabeling");
        if (!auth) {
          updateFloatingCardLabel(null, "idle" as "done");
          return;
        }
        const { provider, model } = auth;
        const { promptTemplate, maxEssayContext } = settings.snippetLabeling;
        const truncatedEssayContent =
          maxEssayContext > 0 ? (piece?.body ?? "").slice(0, maxEssayContext) : "";

        const buildBody = (codexToken: string | undefined) =>
          JSON.stringify({
            snippetContent: content,
            essayContent: truncatedEssayContent,
            goal: resolvedBrief.goal,
            promptTemplate,
            model,
            provider,
            apiKey: auth.apiKey || undefined,
            codexToken,
          });

        // Proactive token validation
        let codexToken: string | undefined;
        if (provider === "codex") {
          const token = await ensureValidCodexToken(
            settings.providerCredentials.codexAccessToken,
            settings.providerCredentials.codexRefreshToken,
            updateProviderCredentials,
          );
          if (!token) {
            app.markProviderBad("codex");
            app.openAiGate("auth-failed", "codex");
            useToastStore.getState().showToast("ChatGPT disconnected. Reconnect in Settings.");
            updateFloatingCardLabel(null, "error");
            return;
          }
          codexToken = token;
        }

        let res = await postLabel(buildBody(codexToken), { signal });

        // Fallback: force refresh on 401
        if (res.status === 401 && provider === "codex") {
          const fresh = await forceRefreshCodexToken(updateProviderCredentials);
          if (fresh) {
            res = await postLabel(buildBody(fresh), { signal });
          }
        }

        const data = await res.json();
        if (data._meta) {
          const modelUsed = (data._meta.modelUsed as string | undefined) || model;
          logApiCall("label", "snip-drag-preview", provider, modelUsed, data._meta, activePieceId ?? undefined).catch(() => {});
        }
        if (!res.ok) {
          if (isAiAuthFailureStatus(res.status)) {
            app.markProviderBad(provider);
            app.openAiGate("auth-failed", provider);
            const toast = provider === "codex" ? "ChatGPT disconnected. Reconnect in Settings." : "API key invalid. Check Settings.";
            useToastStore.getState().showToast(toast);
          }
          updateFloatingCardLabel(null, "error");
          return;
        }
        updateFloatingCardLabel(data.label, "done");
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          updateFloatingCardLabel(null, "error");
        }
      }
    },
    [settings, piece?.body, resolvedBrief.goal, updateFloatingCardLabel, updateProviderCredentials],
  );

  // Keep stable refs current for use inside Tiptap handleDOMEvents closures
  prefetchLabelRef.current = prefetchLabel;
  labelSnippetRef.current = labelSnippet;
  briefGoalRef.current = resolvedBrief.goal;

  // Only used for pending-return drags (native DnD).
  // Normal editor→snippet drags use custom mouse-based drag (see handleDOMEvents.mousedown).
  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      if (!editor) return;
      const { from, to } = editor.state.selection;
      if (from === to) return;

      const selectedText = editor.state.doc.textBetween(from, to, "\n");
      if (!selectedText.trim()) return;

      // Only handle pending-return drag-back
      const pending = useAppStore.getState().pendingSnippetDrop;
      if (pending && !pending.cancelled) {
        const overlaps = from < pending.editorTo && to > pending.editorFrom;
        if (overlaps) {
          e.dataTransfer.setData(
            "application/x-fragment-pending-return",
            JSON.stringify({ snippetId: pending.snippet.id }),
          );
          e.dataTransfer.setData("text/plain", selectedText);
          e.dataTransfer.setData(
            "application/x-fragment-snippet",
            JSON.stringify({ content: selectedText }),
          );
          e.dataTransfer.effectAllowed = "copyMove";
          setDraggingToHelper(true);
        }
      }
    },
    [editor, setDraggingToHelper],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingToHelper(false);
    setFloatingDragCard(null);
    editor?.view.dom.classList.remove("is-snippet-dragging-out");
  }, [editor, setDraggingToHelper, setFloatingDragCard]);

  // Accept drops on the wrapper div — ensures the browser treats it as a valid
  // drop target even when ProseMirror's own dragover handler is skipped by WebKit.
  const handleWrapperDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("application/x-fragment-insert") ||
        e.dataTransfer.types.includes("application/x-fragment-pending-return")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }
  }, []);

  // Fallback drop handler at the wrapper level. ProseMirror's handleDrop (editorProps)
  // handles drops natively, but in Tauri/WKWebView the event may not reach it.
  // If ProseMirror already processed the drop, `defaultPrevented` is true and we skip.
  const handleWrapperDrop = useCallback(
    (e: React.DragEvent) => {
      if (e.defaultPrevented || !editor) return;
      const snippetData = e.dataTransfer?.getData("application/x-fragment-insert");
      if (!snippetData) return;

      e.preventDefault();
      const dropPos = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (!dropPos) return;

      try {
        const { content, id } = JSON.parse(snippetData) as { content: string; id: string };
        const snippetObj = useDataStore.getState().snippets[id];

        const lines = content.split("\n");
        const contentNodes = lines.map((line) => ({
          type: "paragraph" as const,
          content: line.length > 0 ? [{ type: "text" as const, text: line }] : [],
        }));

        const sizeBefore = editor.state.doc.content.size;

        if (snippetObj) {
          pendingSnippetRecordRef.current = { snapshot: { ...snippetObj } };
        }

        editor.chain().insertContentAt(dropPos.pos, contentNodes).run();

        const sizeAfter = editor.state.doc.content.size;
        const insertedSize = sizeAfter - sizeBefore;
        const from = dropPos.pos;
        const to = Math.min(from + Math.max(insertedSize, 1), sizeAfter - 1);

        if (snippetObj) {
          removeSnippet(id);
          setPendingSnippetDrop({
            snippet: { ...snippetObj },
            editorFrom: from,
            editorTo: to,
            cancelled: false,
          });
        }

        useAppStore.getState().setDraggingToEditor(false);
        setTimeout(() => editor.view.focus(), 0);
      } catch {
        pendingSnippetRecordRef.current = null;
      }
      setDraggingToHelper(false);
    },
    [editor, removeSnippet, setDraggingToHelper, setPendingSnippetDrop],
  );

  if (!piece) {
    return <PieceCreationFlow sidebarOpen={sidebarOpen} toggleSidebar={toggleSidebar} onOpenAISettings={onOpenAISettings} onStartGeneration={startGeneration} leftToolbarSlot={leftToolbarSlot} />;
  }

  if (showCreationFlow && !piece.body.trim()) {
    return <PieceCreationFlow sidebarOpen={sidebarOpen} toggleSidebar={toggleSidebar} existingPiece={piece} onOpenAISettings={onOpenAISettings} onStartGeneration={startGeneration} leftToolbarSlot={leftToolbarSlot} />;
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center px-8 pt-6 pb-3 shrink-0 gap-3 min-w-0">
        {leftToolbarSlot}
        {!sidebarOpen && (
          <button
            onClick={toggleSidebar}
            className="shrink-0 p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
        {/* Spacer keeps right-side buttons anchored right during version preview */}
        {timelinePreviewVersionId && <div className="flex-1" />}

        {/* Goal indicator — fills remaining space, truncates before right buttons */}
        {!timelinePreviewVersionId && (
          <div
            className="relative flex-1 min-w-0"
            onMouseEnter={openGoal}
            onMouseLeave={closeGoal}
          >
            <div className="flex items-center gap-2 min-w-0 overflow-hidden cursor-default">
              <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
                Goal
              </span>
              <span className="truncate text-[13px] text-text-secondary">
                {piece.goal
                  ? piece.goal
                  : resolvedBrief.goal
                    ? <span className="text-text-faint">{resolvedBrief.goal}</span>
                    : <span className="text-text-faint">Add a goal…</span>}
              </span>
              {voicesList.length > 0 && (
                <span className="shrink-0 ml-1 px-1.5 py-0.5 rounded bg-surface-3 text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
                  {piece.voiceId === null ? "No voice" : resolvedVoice ? resolvedVoice.name : "No voice"}
                </span>
              )}
            </div>

            {/* Overlay panel */}
            {goalOpen && (
              <div
                onMouseEnter={openGoal}
                onMouseLeave={closeGoal}
                className="absolute top-full left-0 z-50 mt-2 min-w-[300px] bg-surface-2 border border-[var(--color-border-default)] rounded-[var(--radius-lg)] shadow-xl p-4 flex flex-col gap-3"
                style={{ animation: "fadeIn 0.12s ease-out" }}
              >
                {voicesList.length > 0 && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">Voice</span>
                      <select
                        value={piece.voiceId === null ? "__none__" : piece.voiceId === undefined ? "__default__" : piece.voiceId}
                        onChange={(e) => {
                          const v = e.target.value;
                          updatePiece(piece.id, { voiceId: v === "__default__" ? undefined : v === "__none__" ? null : v });
                        }}
                        className="bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1 text-[13px] text-text-secondary outline-none focus:border-border-active"
                      >
                        <option value="__default__">
                          Default{settings.brandVoice.defaultVoiceId && voicesMap[settings.brandVoice.defaultVoiceId] ? ` (${voicesMap[settings.brandVoice.defaultVoiceId].name})` : ""}
                        </option>
                        <option value="__none__">No voice</option>
                        {voicesList.map((v) => (
                          <option key={v.id} value={v.id}>{v.name || "Untitled voice"}</option>
                        ))}
                      </select>
                    </div>
                    <div className="border-t border-[var(--color-surface-3)]" />
                  </>
                )}
                <BriefField
                  label="Goal"
                  value={piece.goal ?? ""}
                  onChange={(v) => updatePiece(piece.id, { goal: v })}
                  inherited={inherited.goal}
                  voiceName={resolvedVoice?.name}
                  placeholder="What are you writing about?"
                />
                <div className="border-t border-[var(--color-surface-3)]" />
                <BriefField
                  label="Audience"
                  value={piece.audience ?? ""}
                  onChange={(v) => updatePiece(piece.id, { audience: v })}
                  inherited={inherited.audience}
                  voiceName={resolvedVoice?.name}
                  placeholder="Who is this for?"
                />
                <div className="border-t border-[var(--color-surface-3)]" />
                <BriefField
                  label="Tone"
                  value={piece.tone ?? ""}
                  onChange={(v) => updatePiece(piece.id, { tone: v })}
                  inherited={inherited.tone}
                  voiceName={resolvedVoice?.name}
                  placeholder="e.g. conversational, formal, witty…"
                />
                <div className="border-t border-[var(--color-surface-3)]" />
                <BriefField
                  label="Remember"
                  value={piece.remember ?? ""}
                  onChange={(v) => updatePiece(piece.id, { remember: v })}
                  inherited={inherited.remember}
                  voiceName={resolvedVoice?.name}
                  placeholder="Things the AI should always keep in mind…"
                  rows={3}
                />
              </div>
            )}
          </div>
        )}

        {/* Save / Generating status indicator */}
        {!timelinePreviewVersionId && (
          <div className="flex items-center gap-1.5 shrink-0 transition-opacity duration-300">
            {isGenerating ? (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-gold">
                  <Loader2 size={11} className="animate-spin" />
                  <span className="text-[10px] font-[family-name:var(--font-mono)]">Generating</span>
                </div>
                <button
                  onClick={abortGeneration}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-[var(--radius-sm)] text-[10px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
                  title="Stop generating"
                >
                  <Square size={8} />
                  Stop
                </button>
              </div>
            ) : saveStatus === "saving" ? (
              <div className="flex items-center gap-1.5 text-text-faint">
                <Loader2 size={11} className="animate-spin" />
                <span className="text-[10px] font-[family-name:var(--font-mono)]">Saving</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-text-faint">
                <Check size={11} />
                <span className="text-[10px] font-[family-name:var(--font-mono)]">Saved</span>
              </div>
            )}
          </div>
        )}

        {/* Right action buttons */}
        <div className="flex items-center gap-2.5 shrink-0">
          {editor && !timelinePreviewVersionId && (
            <CommentsAffordance pieceId={piece.id} editor={editor} />
          )}
          {editor && !timelinePreviewVersionId && (
            <>
              <button
                onClick={() => editor.chain().focus().undo().run()}
                disabled={isGenerating || !editor.can().undo()}
                className="p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150 disabled:opacity-30 disabled:pointer-events-none"
                title="Undo (⌘Z)"
              >
                <Undo2 size={15} />
              </button>
              <button
                onClick={() => editor.chain().focus().redo().run()}
                disabled={isGenerating || !editor.can().redo()}
                className="p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150 disabled:opacity-30 disabled:pointer-events-none"
                title="Redo (⌘⇧Z)"
              >
                <Redo2 size={15} />
              </button>
            </>
          )}
          {/* Snip button removed — now in inline edit bubble menu */}
          {editor && !timelinePreviewVersionId && (
            <ExportMenu pieceId={piece.id} editor={editor} />
          )}
          <button
            onClick={toggleTimeline}
            className={`p-2.5 rounded-[var(--radius-default)] transition-all duration-150 ${
              timelineOpen
                ? "text-gold bg-gold-muted"
                : "text-text-muted hover:text-text-secondary hover:bg-surface-2"
            }`}
            title="Timeline (⌘T)"
          >
            <Clock size={16} />
          </button>
          {!helperBarOpen && !timelineOpen && (
            <button
              onClick={toggleHelperBar}
              className="p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
            >
              <PanelRightOpen size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Divider */}
      <div className="shrink-0 border-b border-[var(--color-surface-3)] mx-8 mb-1" />

      {/* Version preview banner */}
      {timelinePreviewVersionId && <VersionPreviewBanner />}

      {/* Context fields tooltip — hidden during streaming generation */}
      {!timelinePreviewVersionId && !isGenerating && !resolvedBrief.goal && !resolvedBrief.audience && !resolvedBrief.tone && !contextPromptDismissedPieces.has(piece.id) && (
        <ContextFieldsTooltip pieceId={piece.id} onOpenGoal={openGoal} />
      )}

      {/* Editor */}
      <div
        ref={editorScrollRef}
        className="flex-1 overflow-y-auto relative"
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleWrapperDragOver}
        onDrop={handleWrapperDrop}
      >
        <PieceHeader
          title={previewVersion ? previewVersion.title : piece.title ?? ""}
          subtitle={previewVersion ? previewVersion.subtitle ?? "" : piece.subtitle ?? ""}
          disabled={!!timelinePreviewVersionId || isGenerating}
          generatingTitle={generatingTitle}
          onTitleChange={(v) => updatePiece(piece.id, { title: v })}
          onGenerateTitle={() => generateTitle(piece.id, contentRef.current || piece.body)}
          onSubtitleChange={(v) => updatePiece(piece.id, { subtitle: v })}
          onFocusBody={() => {
            // Sync focus — Tiptap's focus() command defers to rAF, which loses
            // keystrokes typed immediately after Enter leaves the subtitle.
            if (!editor) return;
            const { view } = editor;
            const tr = view.state.tr.setSelection(TextSelection.atStart(view.state.doc));
            view.dispatch(tr);
            view.focus();
          }}
        />
        <EditorContent editor={editor} />
        {editor && editor.isEmpty && !timelinePreviewVersionId && !isGenerating && (
          <EmptyPieceActions
            pieceId={piece.id}
            onInsertContent={(content, title) => {
              if (title && !piece.title) {
                updatePiece(piece.id, { title });
              }
              editor.commands.setContent(content);
              if (activePieceId) {
                setLiveEditorContent(activePieceId, content);
                updatePiece(activePieceId, { body: content });
              }
            }}
            onStartGeneration={startGeneration}
            onOpenAISettings={onOpenAISettings}
          />
        )}
        {editor && !timelinePreviewVersionId && inlineEditEnabled && (
          <InlineEditMenu
            editor={editor}
            onSnip={handleAddToSnippets}
            onEdit={handleInlineEdit}
            onCaptureIdea={handleCaptureIdea}
          />
        )}
      </div>
      {activePieceId && !timelinePreviewVersionId && (
        <PieceUsageFooter pieceId={activePieceId} />
      )}
    </div>
  );
}
