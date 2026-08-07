"use client";

import { useState, useRef, useCallback } from "react";
import {
  FileText,
  ClipboardPaste,
  Upload,
  Sparkles,
  ArrowLeft,
  PanelLeftOpen,
  X,
  Lightbulb,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/hooks/use-toast";
import { GeneratePanel, type GeneratePanelSubmit } from "./generate-panel";
import type { Note } from "@/lib/types";
import type { StreamGenerationParams } from "@/hooks/use-stream-generation";

type CreationView = "menu" | "paste" | "generate";

interface NoteCreationFlowProps {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  existingNote?: Note;
  onOpenAISettings?: () => void;
  onStartGeneration?: (params: StreamGenerationParams) => Promise<void>;
  /** The Write | Pieces toggle when an idea is open. Rendered in a toolbar row
   * so an idea with no draft yet can still reach its pieces feed. */
  leftToolbarSlot?: React.ReactNode;
}

export function NoteCreationFlow({ sidebarOpen, toggleSidebar, existingNote, onOpenAISettings, onStartGeneration, leftToolbarSlot }: NoteCreationFlowProps) {
  const createNote = useDataStore((s) => s.createNote);
  const linkNoteToIdea = useContentStore((s) => s.linkNoteToIdea);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const ideaTitle = useContentStore((s) => (activeIdeaId ? s.ideas[activeIdeaId]?.title : undefined));
  const updateNoteContent = useDataStore((s) => s.updateNoteContent);
  const updateNoteTitle = useDataStore((s) => s.updateNoteTitle);
  const updateNoteGoal = useDataStore((s) => s.updateNoteGoal);
  const updateNoteAudience = useDataStore((s) => s.updateNoteAudience);
  const updateNoteTone = useDataStore((s) => s.updateNoteTone);
  const updateNoteRemember = useDataStore((s) => s.updateNoteRemember);
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);
  const settings = useSettingsStore((s) => s.settings);

  const [view, setView] = useState<CreationView>("menu");
  const [pasteContent, setPasteContent] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Finish creating or populating a note. */
  const finishCreate = useCallback(
    (opts?: { title?: string; content?: string; goal?: string; audience?: string; tone?: string; remember?: string }) => {
      if (existingNote) {
        // Note already exists — update it in place
        if (opts?.content) updateNoteContent(existingNote.id, opts.content);
        if (opts?.title) updateNoteTitle(existingNote.id, opts.title);
        if (opts?.goal) updateNoteGoal(existingNote.id, opts.goal);
        if (opts?.audience) updateNoteAudience(existingNote.id, opts.audience);
        if (opts?.tone) updateNoteTone(existingNote.id, opts.tone);
        if (opts?.remember) updateNoteRemember(existingNote.id, opts.remember);
        setShowCreationFlow(false);
        useToastStore.getState().showToast("Note ready");
      } else {
        // No note yet — create one
        const id = createNote(opts);
        if (opts?.goal) updateNoteGoal(id, opts.goal);
        if (opts?.audience) updateNoteAudience(id, opts.audience);
        if (opts?.tone) updateNoteTone(id, opts.tone);
        if (opts?.remember) updateNoteRemember(id, opts.remember);
        // Written inside an idea, so it belongs to that idea. Without this
        // link the note would be born standalone and the idea would still
        // have nothing to write in the next time it's opened.
        if (activeIdeaId) linkNoteToIdea(activeIdeaId, id);
        setActiveNote(id);
        useToastStore.getState().showToast(activeIdeaId ? "Draft added to this idea" : "Note created");
      }
    },
    [existingNote, createNote, setActiveNote, setShowCreationFlow, updateNoteContent, updateNoteTitle, updateNoteGoal, updateNoteAudience, updateNoteTone, updateNoteRemember, activeIdeaId, linkNoteToIdea],
  );

  const handleScratch = useCallback(() => {
    if (existingNote) {
      setShowCreationFlow(false);
    } else {
      finishCreate();
    }
  }, [existingNote, setShowCreationFlow, finishCreate]);

  const handlePasteCreate = useCallback(() => {
    if (!pasteContent.trim()) return;
    finishCreate({ content: pasteContent.trim() });
  }, [pasteContent, finishCreate]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const titleFromFilename = file.name.replace(/\.(md|txt)$/, "");

      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        finishCreate({ title: titleFromFilename, content: text });
      };
      reader.readAsText(file);
      e.target.value = "";
    },
    [finishCreate],
  );

  const handleGenerate = useCallback(
    (params: GeneratePanelSubmit) => {
      if (!onStartGeneration) return;
      // Immediately start streaming — this creates the note and navigates to the editor
      onStartGeneration({ ...params, existingNoteId: existingNote?.id });
    },
    [existingNote?.id, onStartGeneration],
  );

  const aiEnabled = settings.slashCommand.enabled;

  // ─── Sub-flow: Paste ────────────────────────────────────────────────────────
  if (view === "paste") {
    return (
      <FlowShell leftToolbarSlot={leftToolbarSlot} sidebarOpen={sidebarOpen} toggleSidebar={toggleSidebar}>
        <div className="w-full max-w-lg">
          <button
            onClick={() => setView("menu")}
            className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-secondary transition-colors duration-150 mb-5"
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <h3 className="font-[family-name:var(--font-display)] text-base text-text-primary mb-1.5">
            Paste your content
          </h3>
          <p className="text-[12px] text-text-muted mb-4">
            Paste in text, notes, or rough ideas and we&apos;ll create a note from it.
          </p>
          <textarea
            value={pasteContent}
            onChange={(e) => setPasteContent(e.target.value)}
            placeholder="Paste your text here..."
            autoFocus
            className="w-full min-h-[200px] p-4 bg-surface-2 border border-border-strong rounded-[var(--radius-lg)]
              text-[14px] text-text-primary placeholder:text-text-faint
              resize-y outline-none focus:border-border-active transition-colors duration-150"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => setView("menu")}
              className="px-4 py-2 rounded-[var(--radius-default)] text-[13px] text-text-muted hover:text-text-secondary transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              onClick={handlePasteCreate}
              disabled={!pasteContent.trim()}
              className="px-4 py-2 rounded-[var(--radius-default)] text-[13px] font-medium
                bg-gold/10 border border-gold/20 text-gold
                hover:bg-gold/20 disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-150"
            >
              Create note
            </button>
          </div>
        </div>
      </FlowShell>
    );
  }

  // ─── Sub-flow: Generate with AI ─────────────────────────────────────────────
  if (view === "generate") {
    return (
      <FlowShell
        leftToolbarSlot={leftToolbarSlot}
        sidebarOpen={sidebarOpen}
        toggleSidebar={toggleSidebar}
        className="overflow-y-auto py-8"
      >
        <div className="w-full max-w-lg">
          <button
            onClick={() => setView("menu")}
            className="flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-secondary transition-colors duration-150 mb-5"
          >
            <ArrowLeft size={13} />
            Back
          </button>
          <h3 className="font-[family-name:var(--font-display)] text-base text-text-primary mb-1.5">
            Generate with AI
          </h3>
          <p className="text-[12px] text-text-muted mb-4">
            Describe what you&apos;d like to write, or dictate it, and we&apos;ll generate a first draft.
          </p>
          <GeneratePanel
            initial={existingNote ? {
              goal: existingNote.goal,
              audience: existingNote.audience,
              tone: existingNote.tone,
              remember: existingNote.remember,
              voiceId: existingNote.voiceId,
            } : undefined}
            onGenerate={handleGenerate}
            onCancel={() => setView("menu")}
            onOpenAISettings={onOpenAISettings}
          />
        </div>
      </FlowShell>
    );
  }

  // ─── Main menu ──────────────────────────────────────────────────────────────
  return (
    <FlowShell leftToolbarSlot={leftToolbarSlot} sidebarOpen={sidebarOpen} toggleSidebar={toggleSidebar}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="w-full max-w-md">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-text-primary mb-1.5 text-center">
          {activeIdeaId ? `Start a draft in “${ideaTitle?.trim() || "Untitled idea"}”` : "Start a new note"}
        </h2>
        <p className="text-[13px] text-text-muted mb-7 text-center leading-relaxed">
          {activeIdeaId
            ? "Whatever you write here stays inside this idea, alongside its short-form pieces. Switch between them with Write | Pieces above."
            : "Choose how you'd like to begin"}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <CreationCard
            icon={<FileText size={18} />}
            title="Blank note"
            description="Start with an empty page"
            onClick={handleScratch}
          />
          <CreationCard
            icon={<ClipboardPaste size={18} />}
            title="Paste content"
            description="Paste in text you've already written"
            onClick={() => setView("paste")}
          />
          <CreationCard
            icon={<Upload size={18} />}
            title="Import file"
            description="Open a .md or .txt file from your computer"
            onClick={() => fileInputRef.current?.click()}
          />
          <CreationCard
            icon={<Sparkles size={18} />}
            title="Generate with AI"
            description={aiEnabled ? "Describe what you want to write" : "Configure AI in settings first"}
            onClick={() => setView("generate")}
            disabled={!aiEnabled}
          />
        </div>
      </div>
    </FlowShell>
  );
}

// ─── Shared sub-components ──────────────────────────────────────────────────

/**
 * Frame shared by every creation view. When an idea is open the editor hands
 * down its Write | Pieces toggle, which gets its own toolbar row here — the
 * creation flow replaces the whole editor, so without it an idea with no
 * draft yet would have no way back to its pieces.
 */
function FlowShell({
  leftToolbarSlot,
  sidebarOpen,
  toggleSidebar,
  className,
  children,
}: {
  leftToolbarSlot?: React.ReactNode;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 flex flex-col min-h-0" style={{ animation: "fadeIn 0.2s ease-out" }}>
      {leftToolbarSlot && (
        <div className="flex items-center gap-3 px-8 pt-6 pb-3 shrink-0">
          {leftToolbarSlot}
          {!sidebarOpen && (
            <button
              onClick={toggleSidebar}
              className="shrink-0 p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
        </div>
      )}
      <div className={`flex-1 flex flex-col items-center justify-center px-6 ${className ?? ""}`}>
        {!leftToolbarSlot && !sidebarOpen && <SidebarToggle onClick={toggleSidebar} />}
        {children}
      </div>
    </div>
  );
}

function SidebarToggle({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="absolute top-7 left-7 p-2.5 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
    >
      <PanelLeftOpen size={16} />
    </button>
  );
}

function CreationCard({
  icon,
  title,
  description,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-start gap-2.5 p-4 text-left
        rounded-[var(--radius-lg)] bg-surface-2 border border-border-strong
        hover:bg-surface-3 hover:text-text-primary hover:border-gold/20
        disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-surface-2 disabled:hover:border-border-strong
        transition-all duration-150"
    >
      <span className="text-text-muted">{icon}</span>
      <div>
        <span className="block text-[13px] font-medium text-text-secondary">{title}</span>
        <span className="block text-[11px] text-text-faint leading-relaxed mt-0.5">{description}</span>
      </div>
    </button>
  );
}

// ─── Context fields prompt tooltip ──────────────────────────────────────────
// Shown in the editor when a note has no context fields filled in.

export function ContextFieldsTooltip({
  noteId,
  onOpenGoal,
}: {
  noteId: string;
  onOpenGoal: () => void;
}) {
  const dismissContextPrompt = useAppStore((s) => s.dismissContextPrompt);

  return (
    <div
      className="mx-[5rem] mt-3 mb-1 flex items-start gap-3 p-3 rounded-[var(--radius-default)] bg-gold/5 border border-gold/15"
      style={{ animation: "fadeIn 0.2s ease-out" }}
    >
      <Lightbulb size={14} className="shrink-0 text-gold mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-text-secondary leading-relaxed">
          Add a <button onClick={onOpenGoal} className="text-gold hover:text-gold/80 underline underline-offset-2 transition-colors duration-150">goal, audience, and tone</button> to
          get more accurate AI results across all features.
        </p>
      </div>
      <button
        onClick={() => dismissContextPrompt(noteId)}
        className="shrink-0 p-0.5 text-text-faint hover:text-text-muted transition-colors duration-150"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Empty note inline actions ──────────────────────────────────────────────
// Shown inside the editor area when a note exists but has no content.

export function EmptyNoteActions({
  noteId,
  onInsertContent,
  onStartGeneration,
  onOpenAISettings,
}: {
  noteId: string;
  onInsertContent: (content: string, title?: string) => void;
  onStartGeneration?: (params: StreamGenerationParams) => Promise<void>;
  onOpenAISettings?: () => void;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const note = useDataStore((s) => s.notes[noteId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showGenerate, setShowGenerate] = useState(false);

  const aiEnabled = settings.slashCommand.enabled;

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const title = file.name.replace(/\.(md|txt)$/, "");
      const reader = new FileReader();
      reader.onload = () => onInsertContent(reader.result as string, title);
      reader.readAsText(file);
      e.target.value = "";
    },
    [onInsertContent],
  );

  const handleGenerate = useCallback(
    (params: GeneratePanelSubmit) => {
      if (!onStartGeneration) return;
      onStartGeneration({ ...params, existingNoteId: noteId });
    },
    [noteId, onStartGeneration],
  );

  if (showGenerate) {
    return (
      <div className="px-[5rem] mt-4" style={{ animation: "fadeIn 0.15s ease-out" }}>
        <div className="max-w-md">
          <p className="text-[12px] text-text-muted mb-2">Describe what you&apos;d like to write, or dictate it</p>
          <GeneratePanel
            compact
            initial={note ? {
              goal: note.goal,
              audience: note.audience,
              tone: note.tone,
              remember: note.remember,
              // Respect whatever voice the existing note already has.
              voiceId: note.voiceId,
            } : undefined}
            onGenerate={handleGenerate}
            onCancel={() => setShowGenerate(false)}
            onOpenAISettings={onOpenAISettings}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="px-[5rem] mt-4" style={{ animation: "fadeIn 0.2s ease-out" }}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        onChange={handleFileSelect}
        className="hidden"
      />
      <p className="text-[12px] text-text-faint mb-3">or</p>
      <div className="flex items-center gap-2">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px]
            text-text-muted border border-border-strong
            hover:bg-surface-2 hover:text-text-secondary hover:border-gold/20
            transition-all duration-150"
        >
          <Upload size={12} />
          Import file
        </button>
        <button
          onClick={() => setShowGenerate(true)}
          disabled={!aiEnabled}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px]
            text-text-muted border border-border-strong
            hover:bg-surface-2 hover:text-text-secondary hover:border-gold/20
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all duration-150"
        >
          <Sparkles size={12} />
          Generate with AI
        </button>
      </div>
    </div>
  );
}
