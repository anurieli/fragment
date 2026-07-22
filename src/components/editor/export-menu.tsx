"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Share2, FileText, Code, Download, Printer } from "lucide-react";
import { useDataStore } from "@/stores/data-store";
import { useToastStore } from "@/hooks/use-toast";
import {
  copyAsMarkdown,
  copyAsHtml,
  downloadAsMarkdown,
  downloadAsHtml,
  downloadAsPdf,
  downloadAsDocx,
} from "@/lib/export";
import type { Editor } from "@tiptap/react";

interface ExportMenuProps {
  noteId: string;
  editor: Editor;
}

export function ExportMenu({ noteId, editor }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { notes, createVersion } = useDataStore();
  const showToast = useToastStore((s) => s.showToast);
  const note = notes[noteId];

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

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
        title="Export"
      >
        <Share2 size={16} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-[220px] bg-surface border border-border-strong rounded-[var(--radius-lg)] shadow-2xl z-20 overflow-hidden"
          style={{ animation: "fadeIn 0.12s ease-out" }}
        >
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
        </div>
      )}
    </div>
  );
}
