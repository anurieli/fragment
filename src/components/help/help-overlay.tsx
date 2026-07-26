"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface HelpOverlayProps {
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: "⌘ S", action: "Save snapshot (version checkpoint)" },
  { keys: "⌘ T", action: "Toggle document timeline" },
  { keys: "⌘ H", action: "Toggle Snip Bar" },
  { keys: "⌘ \\", action: "Toggle sidebar" },
  { keys: "⌘ 1", action: "Switch to Write space (active idea)" },
  { keys: "⌘ 2", action: "Switch to Pieces space (active idea)" },
  { keys: "⌘ ⇧ F", action: "Search across all notes" },
  { keys: "⌘ /", action: "Open this help panel" },
  { keys: "⌘ F", action: "Find in current note (browser)" },
  { keys: "⌘ Z", action: "Undo" },
  { keys: "⌘ ⇧ Z", action: "Redo" },
  { keys: "⌘ B", action: "Bold" },
  { keys: "⌘ I", action: "Italic" },
  { keys: "/", action: "Flow — AI generation (on empty line)" },
  { keys: "Esc", action: "Close overlays / exit version preview" },
];

const FEATURES = [
  {
    category: "Writing",
    items: [
      { name: "Live Markdown", desc: "Type markdown and it renders instantly — headings, bold, italic, lists, blockquotes, code, links." },
      { name: "Goal Field", desc: "Set a one-liner at the top of each note describing your essay's purpose. Used as AI context." },
      { name: "Flow (Slash Commands)", desc: "Type / on an empty line to generate AI text inline. Preview the result, then insert, discard, or regenerate." },
    ],
  },
  {
    category: "Snip",
    items: [
      { name: "Snip Text", desc: "Select text and click Snip in the floating toolbar to add it to the Snip Bar. Text stays in your doc." },
      { name: "Drag to Snip Bar", desc: "Drag selected text to the right panel. Drop position determines snippet order." },
      { name: "Drag Back to Editor", desc: "Drag a snippet card back into the editor. A gold line shows where it'll land." },
      { name: "Reorder", desc: "Drag snippet cards up/down within the Snip Bar to rearrange." },
      { name: "AI Labels", desc: "Each snippet is automatically labeled by AI so you can scan the list quickly." },
    ],
  },
  {
    category: "Refine",
    items: [
      { name: "Concise", desc: "Select text → click Concise. AI tightens the language while preserving meaning." },
      { name: "Elaborate", desc: "Select text → click Elaborate. AI adds more detail, examples, or nuance." },
      { name: "Custom Edit", desc: "Select text → click Edit → type any instruction. AI rewrites with full document awareness." },
    ],
  },
  {
    category: "Ideas",
    items: [
      { name: "What an Idea Is", desc: "A folder for one thing you're writing about. It holds long-form drafts (notes) and short-form pieces derived from them." },
      { name: "Create & Name", desc: "The bulb button next to New note creates one. Double-click an idea to rename it — a name is how you find it later." },
      { name: "Idea Workspace", desc: "Opening an idea adds a second column beside the sidebar listing its drafts and pieces, with the editor to the right. Collapse it from its header; reopen it from the toolbar button." },
      { name: "Drafts Inside", desc: "Click a draft in the workspace to write in it. The + beside Drafts adds another; any note written while an idea is open belongs to that idea automatically." },
      { name: "Sub-ideas", desc: "⋯ → New sub-idea nests one level deep in the sidebar. A parent's Pieces feed and workspace roll up its children's pieces." },
      { name: "Delete", desc: "⋯ → Delete idea removes the idea, its sub-ideas, and its pieces, with an Undo toast. Drafts survive as standalone notes." },
    ],
  },
  {
    category: "Press",
    items: [
      { name: "Pieces Space", desc: "Every idea gets a short-form feed alongside its long-form draft. Toggle with Write | Pieces (⌘1 / ⌘2)." },
      { name: "Roving Focus", desc: "J/K or the arrow keys move focus between piece cards. Enter opens the textarea, Esc exits back to roving." },
      { name: "Status & Priority", desc: "With a card focused: S cycles status (inbox → in progress → ready), P cycles priority." },
      { name: "Copy & Delete", desc: "C copies a piece's exact text. Backspace deletes it, with an Undo toast." },
      { name: "New Piece & Filters", desc: "N creates a new piece. Number keys 1-4 jump between the All / Inbox / In progress / Ready filters." },
      { name: "Drag Bridge", desc: "Drag a Snip Bar snippet onto the gold line between pieces to drop it in as a new piece." },
      { name: "Agent Inbox", desc: "Agents can drop drafts straight into a piece's inbox — connect fragment-mcp and see them land here." },
    ],
  },
  {
    category: "Export",
    items: [
      { name: "Copy as Markdown", desc: "Copies raw markdown to clipboard." },
      { name: "Copy as HTML", desc: "Copies rendered HTML — paste into emails, docs, etc." },
      { name: "Download .md", desc: "Downloads a markdown file named after your note." },
      { name: "Download .html", desc: "Downloads a styled HTML file matching Fragment's dark theme." },
    ],
  },
  {
    category: "Pass",
    items: [
      { name: "Send for Review", desc: "Share → Send for review downloads a self-contained review page. Send it to anyone — no signup needed on their end." },
      { name: "Reviewer's Side", desc: "The reviewer opens the file in a browser, highlights text to comment (or adds a general note), then hits Send back." },
      { name: "Import Review", desc: "Share → Import review loads the file the reviewer sent back and files its comments against this note." },
      { name: "View Reviews", desc: "Share → View reviews opens the review panel. Click a comment to jump to the matching text in your document." },
    ],
  },
  {
    category: "Timeline",
    items: [
      { name: "Manual Snapshots", desc: "Save a named checkpoint of your document at any time. Cmd+S for quick save." },
      { name: "Auto-Snapshots", desc: "Every export creates a version automatically so you always know what you shipped." },
      { name: "Preview", desc: "Click any version in the timeline to view it in the editor (read-only)." },
      { name: "Restore", desc: "Restore any version. Your current state is always saved first, so you can't lose work." },
    ],
  },
];

export function HelpOverlay({ onClose }: HelpOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === overlayRef.current) {
      onClose();
    }
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      style={{ animation: "fadeIn 0.15s ease-out" }}
    >
      <div className="w-[640px] max-h-[80vh] bg-surface rounded-[var(--radius-xl)] border border-border-strong shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-medium text-text-primary font-[family-name:var(--font-display)]">
            Help
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-[var(--radius-sm)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Keyboard Shortcuts */}
          <section>
            <h3 className="text-[10px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)] mb-3">
              Keyboard Shortcuts
            </h3>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
              {SHORTCUTS.map((s) => (
                <div key={s.keys} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-[12px] text-text-secondary">{s.action}</span>
                  <kbd className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] bg-surface-2 px-2 py-0.5 rounded-[4px] border border-border-strong whitespace-nowrap shrink-0">
                    {s.keys}
                  </kbd>
                </div>
              ))}
            </div>
          </section>

          <div className="border-t border-border" />

          {/* Features */}
          {FEATURES.map((group) => (
            <section key={group.category}>
              <h3 className="text-[10px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)] mb-3">
                {group.category}
              </h3>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <div key={item.name} className="flex gap-3">
                    <span className="text-[12px] text-gold font-medium shrink-0 w-[130px]">
                      {item.name}
                    </span>
                    <span className="text-[12px] text-text-muted leading-relaxed">
                      {item.desc}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-center px-6 py-3 border-t border-border shrink-0">
          <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)]">
            Press <kbd className="bg-surface-2 px-1.5 py-0.5 rounded-[4px] border border-border-strong mx-1">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}
