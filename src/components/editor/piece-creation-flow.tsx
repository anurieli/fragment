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
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/hooks/use-toast";
import { GeneratePanel, type GeneratePanelSubmit } from "./generate-panel";
import { useBrief } from "@/hooks/use-brief";
import { inheritedBrief } from "@/lib/brief-context";
import type { ContentPiece } from "@/lib/content-engine";
import type { StreamGenerationParams } from "@/hooks/use-stream-generation";

type CreationView = "menu" | "paste" | "generate";

interface PieceCreationFlowProps {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  existingPiece?: ContentPiece;
  onOpenAISettings?: () => void;
  onStartGeneration?: (params: StreamGenerationParams) => Promise<void>;
  /** The Write | Pieces toggle when an idea is open. Rendered in a toolbar row
   * so an idea with no draft yet can still reach its pieces feed. */
  leftToolbarSlot?: React.ReactNode;
}

export function PieceCreationFlow({ sidebarOpen, toggleSidebar, existingPiece, onOpenAISettings, onStartGeneration, leftToolbarSlot }: PieceCreationFlowProps) {
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const ideaTitle = useContentStore((s) => (activeIdeaId ? s.ideas[activeIdeaId]?.title : undefined));
  const { idea: existingIdea, voice: existingVoice } = useBrief(existingPiece);
  const createPiece = useContentStore((s) => s.createPiece);
  const createIdeaWithFragment = useContentStore((s) => s.createIdeaWithFragment);
  const updatePiece = useContentStore((s) => s.updatePiece);
  const setActivePiece = useAppStore((s) => s.setActivePiece);
  const setActiveIdea = useAppStore((s) => s.setActiveIdea);
  const setShowCreationFlow = useAppStore((s) => s.setShowCreationFlow);
  const settings = useSettingsStore((s) => s.settings);

  const [view, setView] = useState<CreationView>("menu");
  const [pasteContent, setPasteContent] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Finish creating or populating the fragment being written into. */
  const finishCreate = useCallback(
    (opts?: { title?: string; content?: string; goal?: string; audience?: string; tone?: string; remember?: string }) => {
      // Empty options are left out rather than written as "", so a run through
      // this flow never clears context the fragment already carries.
      const context: Partial<Omit<ContentPiece, "id" | "createdAt">> = {};
      if (opts?.goal) context.goal = opts.goal;
      if (opts?.audience) context.audience = opts.audience;
      if (opts?.tone) context.tone = opts.tone;
      if (opts?.remember) context.remember = opts.remember;

      // createPiece takes no context fields, so a freshly created fragment gets
      // its brief in a second write.
      const applyContext = (pieceId: string) => {
        if (Object.keys(context).length > 0) updatePiece(pieceId, context);
      };

      if (existingPiece) {
        const patch = { ...context };
        if (opts?.content) patch.body = opts.content;
        if (opts?.title) patch.title = opts.title;
        if (Object.keys(patch).length > 0) updatePiece(existingPiece.id, patch);
        setShowCreationFlow(false);
        useToastStore.getState().showToast("Draft ready");
      } else if (activeIdeaId) {
        // Written inside an idea, so the fragment is born in that idea. Long-form
        // by default: this flow hands you the editor, not a card in the feed.
        const pieceId = createPiece({
          ideaId: activeIdeaId,
          format: "essay",
          origin: "user",
          status: "in-progress",
          title: opts?.title,
          body: opts?.content ?? "",
          seen: true,
        });
        if (!pieceId) return;
        applyContext(pieceId);
        setActivePiece(pieceId);
        useToastStore.getState().showToast("Draft added to this idea");
      } else {
        // Nothing open to write into, so the fragment brings its own idea with
        // it. Every fragment belongs to one.
        const { ideaId, pieceId } = createIdeaWithFragment({
          title: opts?.title,
          body: opts?.content,
        });
        if (!pieceId) return;
        applyContext(pieceId);
        setActiveIdea(ideaId);
        setActivePiece(pieceId);
        useToastStore.getState().showToast("Draft created");
      }
    },
    [existingPiece, activeIdeaId, createPiece, createIdeaWithFragment, updatePiece, setActivePiece, setActiveIdea, setShowCreationFlow],
  );

  const handleScratch = useCallback(() => {
    if (existingPiece) {
      setShowCreationFlow(false);
    } else {
      finishCreate();
    }
  }, [existingPiece, setShowCreationFlow, finishCreate]);

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
      // Immediately start streaming: this creates the fragment and navigates to the editor
      onStartGeneration({ ...params, existingPieceId: existingPiece?.id });
    },
    [existingPiece?.id, onStartGeneration],
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
            Paste in text or rough ideas and we&apos;ll create a draft from it.
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
              Create draft
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
            initial={existingPiece ? {
              goal: existingPiece.goal,
              audience: existingPiece.audience,
              tone: existingPiece.tone,
              remember: existingPiece.remember,
              voiceId: existingPiece.voiceId,
            } : undefined}
            inherited={inheritedBrief("fragment", { piece: existingPiece, idea: existingIdea, voice: existingVoice })}
            voiceName={existingVoice?.name}
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
          {activeIdeaId ? `Start a draft in “${ideaTitle?.trim() || "Untitled idea"}”` : "Start a new draft"}
        </h2>
        <p className="text-[13px] text-text-muted mb-7 text-center leading-relaxed">
          {activeIdeaId
            ? "Whatever you write here stays inside this idea, alongside its short-form pieces. Switch between them with Write | Pieces above."
            : "Choose how you'd like to begin"}
        </p>

        <div className="grid grid-cols-2 gap-3">
          <CreationCard
            icon={<FileText size={18} />}
            title="Blank draft"
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
// Shown in the editor when a fragment has no context fields filled in.

export function ContextFieldsTooltip({
  pieceId,
  onOpenGoal,
}: {
  pieceId: string;
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
        onClick={() => dismissContextPrompt(pieceId)}
        className="shrink-0 p-0.5 text-text-faint hover:text-text-muted transition-colors duration-150"
      >
        <X size={12} />
      </button>
    </div>
  );
}

// ─── Empty fragment inline actions ──────────────────────────────────────────
// Shown inside the editor area when a fragment exists but has no body yet.

export function EmptyPieceActions({
  pieceId,
  onInsertContent,
  onStartGeneration,
  onOpenAISettings,
}: {
  pieceId: string;
  onInsertContent: (content: string, title?: string) => void;
  onStartGeneration?: (params: StreamGenerationParams) => Promise<void>;
  onOpenAISettings?: () => void;
}) {
  const settings = useSettingsStore((s) => s.settings);
  const piece = useContentStore((s) => s.pieces[pieceId]);
  const { idea: pieceIdea, voice: pieceVoice } = useBrief(piece);
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
      onStartGeneration({ ...params, existingPieceId: pieceId });
    },
    [pieceId, onStartGeneration],
  );

  if (showGenerate) {
    return (
      <div className="px-[5rem] mt-4" style={{ animation: "fadeIn 0.15s ease-out" }}>
        <div className="max-w-md">
          <p className="text-[12px] text-text-muted mb-2">Describe what you&apos;d like to write, or dictate it</p>
          <GeneratePanel
            compact
            initial={piece ? {
              goal: piece.goal,
              audience: piece.audience,
              tone: piece.tone,
              remember: piece.remember,
              // Respect whatever voice the fragment already has.
              voiceId: piece.voiceId,
            } : undefined}
            inherited={inheritedBrief("fragment", { piece, idea: pieceIdea, voice: pieceVoice })}
            voiceName={pieceVoice?.name}
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
