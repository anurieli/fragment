"use client";

import { useState, useRef, useCallback } from "react";
import {
  FileText,
  ClipboardPaste,
  Upload,
  Sparkles,
  ArrowLeft,
  PanelLeftOpen,
  ChevronDown,
  ChevronRight,
  X,
  Lightbulb,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { useToastStore } from "@/hooks/use-toast";
import type { Note } from "@/lib/types";
import type { StreamGenerationParams } from "@/hooks/use-stream-generation";

type CreationView = "menu" | "paste" | "generate";

interface NoteCreationFlowProps {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  existingNote?: Note;
  onOpenAISettings?: () => void;
  onStartGeneration?: (params: StreamGenerationParams) => Promise<void>;
}

export function NoteCreationFlow({ sidebarOpen, toggleSidebar, existingNote, onOpenAISettings, onStartGeneration }: NoteCreationFlowProps) {
  const createNote = useDataStore((s) => s.createNote);
  const updateNoteContent = useDataStore((s) => s.updateNoteContent);
  const updateNoteTitle = useDataStore((s) => s.updateNoteTitle);
  const updateNoteGoal = useDataStore((s) => s.updateNoteGoal);
  const updateNoteAudience = useDataStore((s) => s.updateNoteAudience);
  const updateNoteTone = useDataStore((s) => s.updateNoteTone);
  const updateNoteRemember = useDataStore((s) => s.updateNoteRemember);
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);
  const settings = useSettingsStore((s) => s.settings);
  const voicesMap = useVoiceStore((s) => s.voices);
  const voicesList = Object.values(voicesMap).sort((a, b) => a.createdAt - b.createdAt);

  const [view, setView] = useState<CreationView>("menu");
  const [pasteContent, setPasteContent] = useState("");
  const [generatePrompt, setGeneratePrompt] = useState("");

  // Context fields for generate sub-flow
  const [genGoal, setGenGoal] = useState("");
  const [genAudience, setGenAudience] = useState("");
  const [genTone, setGenTone] = useState("");
  const [genRemember, setGenRemember] = useState("");
  const [genVoiceId, setGenVoiceId] = useState<string | null | undefined>(undefined);
  const [contextExpanded, setContextExpanded] = useState(false);

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
        setActiveNote(id);
        useToastStore.getState().showToast("Note created");
      }
    },
    [existingNote, createNote, setActiveNote, setShowCreationFlow, updateNoteContent, updateNoteTitle, updateNoteGoal, updateNoteAudience, updateNoteTone, updateNoteRemember],
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

  const handleGenerate = useCallback(async () => {
    if (!generatePrompt.trim() || !onStartGeneration) return;

    // Immediately start streaming — this creates the note and navigates to the editor
    onStartGeneration({
      prompt: generatePrompt.trim(),
      goal: genGoal,
      audience: genAudience,
      tone: genTone,
      remember: genRemember,
      voiceId: genVoiceId,
      existingNoteId: existingNote?.id,
    });
  }, [generatePrompt, genGoal, genAudience, genTone, genRemember, genVoiceId, existingNote?.id, onStartGeneration]);

  const aiEnabled = settings.slashCommand.enabled;
  const activeProvider = settings.featureProviders.slashCommand.provider;
  const activeModel = settings.featureProviders.slashCommand.model;

  // ─── Sub-flow: Paste ────────────────────────────────────────────────────────
  if (view === "paste") {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6" style={{ animation: "fadeIn 0.2s ease-out" }}>
        {!sidebarOpen && <SidebarToggle onClick={toggleSidebar} />}
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
      </div>
    );
  }

  // ─── Sub-flow: Generate with AI ─────────────────────────────────────────────
  if (view === "generate") {
    const modelDisplayName = activeModel.split("/").pop() || activeModel;

    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto py-8" style={{ animation: "fadeIn 0.2s ease-out" }}>
        {!sidebarOpen && <SidebarToggle onClick={toggleSidebar} />}
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
            Describe what you&apos;d like to write and we&apos;ll generate a first draft.
          </p>

          {/* Prompt textarea */}
          <textarea
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            placeholder="e.g., A blog post about why most productivity advice is wrong, aimed at startup founders..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && generatePrompt.trim()) {
                handleGenerate();
              }
            }}
            className="w-full min-h-[120px] p-4 bg-surface-2 border border-border-strong rounded-[var(--radius-lg)]
              text-[14px] text-text-primary placeholder:text-text-faint
              resize-y outline-none focus:border-border-active transition-colors duration-150"
          />

          {/* Model indicator — clickable to open AI settings */}
          <div className="mt-2 mb-3">
            <button
              onClick={onOpenAISettings}
              className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] hover:text-text-muted transition-colors duration-150"
              title="Change model in AI settings"
            >
              {modelDisplayName}
            </button>
          </div>

          {/* Context fields dropdown — below textarea */}
          <div className="mb-4">
            <button
              onClick={() => setContextExpanded(!contextExpanded)}
              className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary transition-colors duration-150"
            >
              {contextExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Add context
            </button>
            {contextExpanded && (
              <div
                className="mt-2 space-y-3 p-3 bg-surface-2 border border-border-strong rounded-[var(--radius-default)]"
                style={{ animation: "fadeIn 0.15s ease-out" }}
              >
                <p className="text-[10px] text-text-faint leading-relaxed">
                  Helps the AI write a better first draft. You can always edit these later in the toolbar.
                </p>
                <ContextInput
                  label="Goal"
                  value={genGoal}
                  onChange={setGenGoal}
                  placeholder="What are you writing about?"
                />
                <ContextInput
                  label="Audience"
                  value={genAudience}
                  onChange={setGenAudience}
                  placeholder="Who is this for?"
                />
                <ContextInput
                  label="Tone"
                  value={genTone}
                  onChange={setGenTone}
                  placeholder="e.g. conversational, formal, witty..."
                />
                <ContextInput
                  label="Remember"
                  value={genRemember}
                  onChange={setGenRemember}
                  placeholder="Things the AI should keep in mind..."
                />
                {voicesList.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
                      Voice
                    </label>
                    <select
                      value={genVoiceId === null ? "__none__" : genVoiceId === undefined ? "__default__" : genVoiceId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setGenVoiceId(v === "__default__" ? undefined : v === "__none__" ? null : v);
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
                )}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setView("menu")}
              className="px-4 py-2 rounded-[var(--radius-default)] text-[13px] text-text-muted hover:text-text-secondary transition-colors duration-150"
            >
              Cancel
            </button>
            <button
              onClick={handleGenerate}
              disabled={!generatePrompt.trim() || !onStartGeneration}
              className="flex items-center gap-2 px-4 py-2 rounded-[var(--radius-default)] text-[13px] font-medium
                bg-gold/10 border border-gold/20 text-gold
                hover:bg-gold/20 disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-150"
            >
              Generate note
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Main menu ──────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6" style={{ animation: "fadeIn 0.2s ease-out" }}>
      {!sidebarOpen && <SidebarToggle onClick={toggleSidebar} />}

      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.txt"
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="w-full max-w-md">
        <h2 className="font-[family-name:var(--font-display)] text-lg text-text-primary mb-1.5 text-center">
          Start a new note
        </h2>
        <p className="text-[13px] text-text-muted mb-7 text-center">
          Choose how you&apos;d like to begin
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
    </div>
  );
}

// ─── Shared sub-components ──────────────────────────────────────────────────

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

function ContextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-surface-3/50 text-[12px] text-text-secondary placeholder:text-text-faint outline-none
          border-b border-border-strong focus:border-border-active pb-1.5 transition-colors duration-150"
      />
    </div>
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
}: {
  noteId: string;
  onInsertContent: (content: string, title?: string) => void;
  onStartGeneration?: (params: StreamGenerationParams) => Promise<void>;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [generatePrompt, setGeneratePrompt] = useState("");

  const aiEnabled = settings.slashCommand.enabled;
  const activeProvider = settings.featureProviders.slashCommand.provider;
  const activeModel = settings.featureProviders.slashCommand.model;

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

  const handleGenerate = useCallback(() => {
    if (!generatePrompt.trim() || !onStartGeneration) return;
    onStartGeneration({
      prompt: generatePrompt.trim(),
      goal: "",
      audience: "",
      tone: "",
      remember: "",
      // Respect whatever voice the existing note already has.
      voiceId: useDataStore.getState().notes[noteId]?.voiceId,
      existingNoteId: noteId,
    });
  }, [generatePrompt, noteId, onStartGeneration]);

  if (showGenerate) {
    return (
      <div className="px-[5rem] mt-4" style={{ animation: "fadeIn 0.15s ease-out" }}>
        <div className="max-w-md">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[12px] text-text-muted">Describe what you&apos;d like to write</p>
            <button
              onClick={() => setShowGenerate(false)}
              className="text-[11px] text-text-faint hover:text-text-muted transition-colors duration-150"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] mb-2">
            Using {activeProvider} &middot; {activeModel.split("/").pop()}
          </p>
          <textarea
            value={generatePrompt}
            onChange={(e) => setGeneratePrompt(e.target.value)}
            placeholder="e.g., A blog post about why most productivity advice is wrong..."
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && generatePrompt.trim()) {
                handleGenerate();
              }
            }}
            className="w-full min-h-[80px] p-3 bg-surface-2 border border-border-strong rounded-[var(--radius-default)]
              text-[13px] text-text-primary placeholder:text-text-faint
              resize-y outline-none focus:border-border-active transition-colors duration-150"
          />
          <div className="flex justify-end mt-2">
            <button
              onClick={handleGenerate}
              disabled={!generatePrompt.trim() || !onStartGeneration}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[12px] font-medium
                bg-gold/10 border border-gold/20 text-gold
                hover:bg-gold/20 disabled:opacity-40 disabled:cursor-not-allowed
                transition-all duration-150"
            >
              Generate
            </button>
          </div>
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
