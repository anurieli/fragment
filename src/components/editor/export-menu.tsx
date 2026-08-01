"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useMenuPlacement } from "@/hooks/use-menu-placement";
import { Share2, FileText, Code, Download, Printer, MessageSquare, Upload, Rss, FileCode2, Mail, Link2 } from "lucide-react";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/hooks/use-toast";
import { useReviewStore } from "@/stores/review-store";
import {
  copyForPlatform,
  openComposer,
  createKitBroadcast,
  deriveKitSubject,
  markdownToCleanHtml,
} from "@/lib/publish";
import {
  copyAsMarkdown,
  copyAsHtml,
  downloadAsMarkdown,
  downloadAsHtml,
  downloadAsPdf,
  downloadAsDocx,
} from "@/lib/export";
import { buildReviewFile, reviewFileName, parseReviewReturn } from "@/lib/review";
import { ReviewPanel } from "@/components/review/review-panel";
import { ShareDialog } from "@/components/review/share-dialog";
import { isHosted } from "@/lib/edition";
import type { Editor } from "@tiptap/react";

interface ExportMenuProps {
  noteId: string;
  editor: Editor;
}

function triggerHtmlDownload(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ExportMenu({ noteId, editor }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [reviewPanelOpen, setReviewPanelOpen] = useState(false);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [kitDraftBusy, setKitDraftBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  // This menu hangs off a toolbar that can sit low in the window, and it's
  // long enough (publish, copy, download, review) to run off the bottom.
  const placement = useMenuPlacement(open, menuRef, dropdownRef);
  const { notes, createVersion } = useDataStore();
  const markNotePublishPending = useDataStore((s) => s.markNotePublishPending);
  const userProfile = useSettingsStore((s) => s.settings.userProfile);
  const showToast = useToastStore((s) => s.showToast);
  const substackPublicationUrl = userProfile.substackPublicationUrl;
  const hasSubstackPub = Boolean(substackPublicationUrl?.trim());
  const kitApiKey = userProfile.kitApiKey;
  const hasKitKey = Boolean(kitApiKey?.trim());
  const saveReviewReturn = useReviewStore((s) => s.saveReviewReturn);
  const note = notes[noteId];
  // Link sharing needs a server to point the link at. The self-hosted and
  // desktop builds keep the emailed-file route, which needs nothing.
  const canShareLink = isHosted();

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const getMarkdown = useCallback((): string => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (editor.storage as any).markdown.getMarkdown() as string;
  }, [editor]);

  const getHtml = useCallback((): string => {
    return editor.getHTML();
  }, [editor]);

  const getJson = useCallback(() => {
    return editor.getJSON();
  }, [editor]);

  if (!note) return null;

  async function handleCopyMarkdown() {
    createVersion(noteId, "Copied as Markdown", "export-md");
    await copyAsMarkdown(getMarkdown());
    showToast("Copied as Markdown");
    setOpen(false);
  }

  async function handleCopyHtml() {
    createVersion(noteId, "Copied as HTML", "export-html");
    await copyAsHtml(getHtml());
    showToast("Copied as HTML");
    setOpen(false);
  }

  // "Clean" HTML here means the publish pipeline's semantic markdown->HTML
  // (src/lib/publish/markdown.ts) — headings/bold/links/lists only, no raw
  // Tiptap editor markup — which is what pastes cleanly into Substack's
  // rich-text composer. Distinct from "Copy as HTML" above (editor.getHTML()).
  async function handleCopyCleanHtml() {
    createVersion(noteId, "Copied as clean HTML", "export-html");
    await copyForPlatform(getMarkdown(), "html");
    showToast("Copied as clean HTML");
    setOpen(false);
  }

  function handlePublishToSubstack() {
    if (!hasSubstackPub) return;
    // Open the composer synchronously (within the click gesture) before the
    // async clipboard write — see copyForPlatform's doc comment on
    // user-gesture timing for why the ordering matters here.
    openComposer("substack", { publicationUrl: substackPublicationUrl });
    void copyForPlatform(getMarkdown(), "substack");
    markNotePublishPending(noteId);
    showToast("Copied. Opening Substack — Fragment will confirm once it's live.");
    setOpen(false);
  }

  // ARI-164: a Kit draft is not "published" — notes have no status field to
  // begin with, so unlike the piece-share-menu's "Schedule on Kit" (which
  // does flip a piece to "published"), this action is toast-only. Nothing
  // is stamped: `markNotePublishPending` is reserved for the Substack RSS
  // verified-publish loop (use-publish-verification.ts polls the Substack
  // feed specifically), which a Kit draft has no bearing on.
  async function handleSendToKitDraft() {
    if (!hasKitKey || kitDraftBusy) return;
    setKitDraftBusy(true);
    try {
      const markdown = getMarkdown();
      const result = await createKitBroadcast({
        apiKey: kitApiKey,
        subject: deriveKitSubject(note.title, markdown),
        contentHtml: markdownToCleanHtml(markdown),
      });
      showToast(`Draft created in Kit — finish it there: ${result.url}`);
      setOpen(false);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't create the Kit draft.");
    } finally {
      setKitDraftBusy(false);
    }
  }

  function handleDownloadMd() {
    createVersion(noteId, "Downloaded as .md", "download-md");
    const filename = downloadAsMarkdown(getMarkdown(), note.title);
    showToast(`Downloaded ${filename}`);
    setOpen(false);
  }

  function handleDownloadHtml() {
    createVersion(noteId, "Downloaded as .html", "download-html");
    const filename = downloadAsHtml(getHtml(), note.title);
    showToast(`Downloaded ${filename}`);
    setOpen(false);
  }

  async function handleDownloadPdf() {
    createVersion(noteId, "Downloaded as PDF", "download-pdf");
    const filename = await downloadAsPdf(getHtml(), note.title);
    showToast(`Downloaded ${filename}`);
    setOpen(false);
  }

  async function handleDownloadDocx() {
    createVersion(noteId, "Downloaded as .docx", "download-docx");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filename = await downloadAsDocx(getJson() as any, note.title);
    showToast(`Downloaded ${filename}`);
    setOpen(false);
  }

  function handleSendForReview() {
    const html = buildReviewFile(
      { title: note.title, markdown: getMarkdown() },
      { authorName: userProfile.displayName, authorEmail: userProfile.email }
    );
    triggerHtmlDownload(html, reviewFileName(note.title));
    showToast("Review file downloaded — email it to your reviewer");
    setOpen(false);
  }

  function handleImportReviewClick() {
    importInputRef.current?.click();
    setOpen(false);
  }

  async function handleImportReviewFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    try {
      const text = await file.text();
      const review = parseReviewReturn(text);
      await saveReviewReturn(noteId, review);
      showToast(
        `Imported ${review.comments.length} comment${review.comments.length === 1 ? "" : "s"} from ${review.reviewerName || "reviewer"}`
      );
      setReviewPanelOpen(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't read that review file");
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
        title="Share / Export"
      >
        <Share2 size={16} />
      </button>

      {open && (
        <div
          ref={dropdownRef}
          className={`absolute right-0 ${placement.className} w-[220px] bg-surface border border-border-strong rounded-[var(--radius-lg)] shadow-2xl z-20 overflow-y-auto`}
          style={{ animation: "fadeIn 0.12s ease-out", maxHeight: placement.maxHeight || undefined }}
        >
          <button
            onClick={handlePublishToSubstack}
            disabled={!hasSubstackPub}
            title={hasSubstackPub ? undefined : "Set your Substack publication URL in Settings → Profile first"}
            className={`flex items-center gap-3 w-full px-4 py-2.5 text-[12px] transition-all duration-150 ${
              hasSubstackPub
                ? "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                : "text-text-faint opacity-50 cursor-not-allowed"
            }`}
          >
            <Rss size={13} className="shrink-0" />
            <span className="flex-1 text-left">Publish to Substack</span>
          </button>
          <button
            onClick={handleSendToKitDraft}
            disabled={!hasKitKey || kitDraftBusy}
            title={hasKitKey ? undefined : "Add your Kit API key in Settings → Profile first"}
            className={`flex items-center gap-3 w-full px-4 py-2.5 text-[12px] transition-all duration-150 ${
              hasKitKey
                ? "text-text-secondary hover:bg-surface-2 hover:text-text-primary"
                : "text-text-faint opacity-50 cursor-not-allowed"
            }`}
          >
            <Mail size={13} className="shrink-0" />
            <span className="flex-1 text-left">
              {kitDraftBusy ? "Sending…" : "Send to Kit as draft"}
            </span>
          </button>
          <button
            onClick={handleCopyCleanHtml}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
          >
            <FileCode2 size={13} className="shrink-0" />
            <span className="flex-1 text-left">Copy as clean HTML</span>
          </button>

          <div className="mx-3 border-t border-border" />

          <button
            onClick={handleCopyMarkdown}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
          >
            <FileText size={13} className="shrink-0" />
            <span className="flex-1 text-left">Copy as Markdown</span>
          </button>
          <button
            onClick={handleCopyHtml}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
          >
            <Code size={13} className="shrink-0" />
            <span className="flex-1 text-left">Copy as HTML</span>
          </button>

          <div className="mx-3 border-t border-border" />

          <button
            onClick={handleDownloadMd}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
          >
            <Download size={13} className="shrink-0" />
            <span className="flex-1 text-left">Download as .md</span>
          </button>
          <button
            onClick={handleDownloadHtml}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
          >
            <Download size={13} className="shrink-0" />
            <span className="flex-1 text-left">Download as .html</span>
          </button>
          <button
            onClick={handleDownloadDocx}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
          >
            <Download size={13} className="shrink-0" />
            <span className="flex-1 text-left">Download as .docx</span>
          </button>
          <button
            onClick={handleDownloadPdf}
            className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
          >
            <Printer size={13} className="shrink-0" />
            <span className="flex-1 text-left">Download as PDF</span>
          </button>

          <div className="mx-3 border-t border-border" />

          {canShareLink ? (
            <button
              onClick={() => {
                setShareDialogOpen(true);
                setOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
              title="Get a link reviewers can open to read and comment — no account needed on their end"
            >
              <Link2 size={13} className="shrink-0" />
              <span className="flex-1 text-left">Share</span>
            </button>
          ) : (
            <>
              <button
                onClick={handleSendForReview}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
                title="Downloads a self-contained HTML file — no accounts, works offline, email it to anyone"
              >
                <MessageSquare size={13} className="shrink-0" />
                <span className="flex-1 text-left">Send for review</span>
              </button>
              <button
                onClick={handleImportReviewClick}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
                title="Load a .fragment-review.json file a reviewer sent back"
              >
                <Upload size={13} className="shrink-0" />
                <span className="flex-1 text-left">Import review</span>
              </button>
              <button
                onClick={() => {
                  setReviewPanelOpen(true);
                  setOpen(false);
                }}
                className="flex items-center gap-3 w-full px-4 py-2.5 text-[12px] text-text-secondary hover:bg-surface-2 hover:text-text-primary transition-all duration-150"
                title="See comments imported from reviewers"
              >
                <MessageSquare size={13} className="shrink-0" />
                <span className="flex-1 text-left">View reviews</span>
              </button>
              <input
                ref={importInputRef}
                type="file"
                accept=".json,.fragment-review.json,application/json"
                onChange={handleImportReviewFile}
                className="hidden"
              />
            </>
          )}
        </div>
      )}

      {reviewPanelOpen && (
        <ReviewPanel noteId={noteId} editor={editor} onClose={() => setReviewPanelOpen(false)} />
      )}

      {shareDialogOpen && (
        <ShareDialog
          noteId={noteId}
          title={note.title}
          // Read at click time, not render time, so the frozen copy reviewers
          // see is what was on screen when the link was made.
          getMarkdown={getMarkdown}
          onClose={() => setShareDialogOpen(false)}
        />
      )}
    </div>
  );
}
