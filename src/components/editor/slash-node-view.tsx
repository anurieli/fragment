"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { DOMParser as ProseMirrorDOMParser } from "@tiptap/pm/model";
import { Loader2, Check, X, RotateCcw, Square } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useSlashCommand } from "@/hooks/use-slash-command";
import markdownit from "markdown-it";

const md = markdownit({ html: false, linkify: false, breaks: false });

const SLASH_PLACEHOLDERS = [
  "Add a sentence that...",
  "Add a paragraph that...",
  "Add a section on...",
];

export function SlashNodeView({ editor, getPos, node }: NodeViewProps) {
  const activePieceId = useAppStore((s) => s.activePieceId);
  const pieces = useContentStore((s) => s.pieces);
  const piece = activePieceId ? pieces[activePieceId] : null;
  const { generateStream, abort, enabled: slashEnabled } = useSlashCommand();

  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const streamContentRef = useRef<HTMLDivElement>(null);

  // Auto-scroll streaming content to bottom
  useEffect(() => {
    if (streamingText !== null && streamContentRef.current) {
      streamContentRef.current.scrollTop = streamContentRef.current.scrollHeight;
    }
  }, [streamingText]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  // Rotate placeholder
  useEffect(() => {
    if (loading || preview || streamingText !== null) return;
    const interval = setInterval(() => {
      setPlaceholderIndex((i) => (i + 1) % SLASH_PLACEHOLDERS.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [loading, preview, streamingText]);

  const getNodePos = useCallback(() => {
    return typeof getPos === "function" ? getPos() : undefined;
  }, [getPos]);

  const dismiss = useCallback(() => {
    abort();
    const pos = getNodePos();
    if (pos === undefined) return;
    const replacedEmpty = node.attrs.replacedEmpty as boolean;
    if (replacedEmpty) {
      editor
        .chain()
        .deleteRange({ from: pos, to: pos + node.nodeSize })
        .insertContentAt(pos, { type: "paragraph" })
        .run();
    } else {
      editor.chain().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    }
    editor.commands.focus();
  }, [editor, getNodePos, node, abort]);

  const accept = useCallback(() => {
    if (!preview) return;
    const pos = getNodePos();
    if (pos === undefined) return;

    // Render markdown → HTML → ProseMirror nodes (preserves block structure).
    // We bypass tiptap-markdown's insertContentAt override which forces
    // { inline: true } and unwraps the first <p>, destroying headings.
    const html = md.render(preview);
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html;
    const parsed = ProseMirrorDOMParser.fromSchema(
      editor.state.schema,
    ).parse(wrapper);

    const tr = editor.state.tr;
    tr.replaceWith(pos, pos + node.nodeSize, parsed.content);
    editor.view.dispatch(tr);

    editor.commands.focus();
  }, [editor, getNodePos, node, preview]);

  const submit = useCallback(async () => {
    if (!piece || !prompt.trim() || !slashEnabled) return;

    setLoading(true);
    setError(false);
    setPreview(null);
    setStreamingText(null);

    const pos = getNodePos() ?? 0;
    let charOffset = 0;
    editor.state.doc.nodesBetween(0, pos, (n) => {
      if (n.isText) charOffset += n.text?.length ?? 0;
    });
    const fullText = editor.state.doc.textContent;
    const contextAbove = fullText.slice(0, charOffset);
    const contextBelow = fullText.slice(charOffset);

    await generateStream(
      contextAbove,
      contextBelow,
      piece.goal ?? "",
      piece.audience ?? "",
      piece.tone ?? "",
      piece.remember ?? "",
      prompt,
      {
        onChunk: (accumulated) => {
          setStreamingText(accumulated);
        },
        onDone: (final) => {
          setLoading(false);
          setStreamingText(null);
          setPreview(final);
        },
        onError: () => {
          setLoading(false);
          setStreamingText(null);
          setError(true);
          setTimeout(() => setError(false), 3000);
        },
      },
      activePieceId ?? undefined,
      piece.voiceId,
    );
  }, [editor, piece, prompt, generateStream, getNodePos, slashEnabled]);

  const stopGeneration = useCallback(() => {
    abort();
    if (streamingText) {
      setPreview(streamingText);
    }
    setLoading(false);
    setStreamingText(null);
  }, [abort, streamingText]);

  const regenerate = useCallback(() => {
    setPreview(null);
    setStreamingText(null);
    setTimeout(() => submit(), 0);
  }, [submit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Backspace" && (e.target as HTMLInputElement).value === "") {
        e.preventDefault();
        dismiss();
      } else if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    },
    [dismiss, submit],
  );

  // Global keyboard shortcuts while preview is showing
  useEffect(() => {
    if (!preview) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        accept();
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPreview(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      } else if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        regenerate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [preview, accept, regenerate]);

  // Escape to stop streaming
  useEffect(() => {
    if (!loading || streamingText === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        stopGeneration();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loading, streamingText, stopGeneration]);

  // Dismiss slash UI when clicking outside of it
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (containerRef.current?.contains(target)) return;
      if (loading) return;
      dismiss();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [dismiss, loading]);

  const isStreaming = loading && streamingText !== null;

  return (
    <NodeViewWrapper ref={containerRef}>
      {preview ? (
        <div
          className="rounded-[var(--radius-lg)] border border-gold-strong bg-surface overflow-hidden my-2"
          style={{ animation: "fadeIn 0.15s ease-out" }}
          contentEditable={false}
        >
          <div className="flex items-center justify-between px-4 py-3 bg-gold-muted border-b border-gold-strong">
            <div className="flex items-center gap-2">
              <span className="text-gold text-sm font-medium">/</span>
              <span className="text-[11px] text-text-secondary font-[family-name:var(--font-mono)] truncate max-w-[280px]">
                {prompt}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={regenerate}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
                title="Regenerate (⌘R)"
              >
                <RotateCcw size={11} />
                <span className="font-[family-name:var(--font-mono)]">Redo</span>
              </button>
              <button
                onClick={() => {
                  setPreview(null);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] text-red hover:bg-red-muted transition-all duration-150"
                title="Discard (Esc)"
              >
                <X size={12} />
                <span className="font-[family-name:var(--font-mono)]">Discard</span>
              </button>
              <button
                onClick={accept}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-medium text-gold bg-gold-muted border border-gold-strong hover:bg-gold-strong transition-all duration-150"
                title="Insert (Enter)"
              >
                <Check size={12} />
                <span className="font-[family-name:var(--font-mono)]">Insert</span>
              </button>
            </div>
          </div>
          <div className="px-5 py-4 max-h-[240px] overflow-y-auto">
            <div
              className="prose-preview text-[15px] leading-[1.75] text-text-primary"
              dangerouslySetInnerHTML={{ __html: md.render(preview) }}
            />
          </div>
          <div className="flex items-center justify-end gap-4 px-4 py-2 border-t border-border bg-surface">
            <span className="text-[9px] text-text-faint font-[family-name:var(--font-mono)]">
              <kbd className="bg-surface-2 px-1.5 py-0.5 rounded-[4px] border border-border-strong">↵</kbd>{" "}
              insert
            </span>
            <span className="text-[9px] text-text-faint font-[family-name:var(--font-mono)]">
              <kbd className="bg-surface-2 px-1.5 py-0.5 rounded-[4px] border border-border-strong">esc</kbd>{" "}
              discard
            </span>
            <span className="text-[9px] text-text-faint font-[family-name:var(--font-mono)]">
              <kbd className="bg-surface-2 px-1.5 py-0.5 rounded-[4px] border border-border-strong">⌘R</kbd>{" "}
              redo
            </span>
          </div>
        </div>
      ) : (
        <div
          className={`rounded-[var(--radius-lg)] border my-2 ${
            error ? "border-red bg-red-muted" : "border-gold bg-gold-muted"
          } transition-colors duration-150`}
          style={{ animation: "fadeIn 0.12s ease-out" }}
          contentEditable={false}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            {loading ? (
              <Loader2
                size={14}
                className="text-gold shrink-0"
                style={{ animation: "spin 1s linear infinite" }}
              />
            ) : (
              <span className="text-gold text-sm font-medium shrink-0">/</span>
            )}
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={loading}
                className="w-full bg-transparent text-[13px] text-text-primary outline-none disabled:opacity-50"
              />
              {prompt === "" && !loading && (
                <span
                  key={placeholderIndex}
                  className="absolute inset-y-0 left-0 flex items-center text-[13px] text-text-muted pointer-events-none"
                  style={{ animation: "slashPlaceholder 0.3s ease-out" }}
                >
                  {SLASH_PLACEHOLDERS[placeholderIndex]}
                </span>
              )}
            </div>
            {error && (
              <span className="text-[10px] text-red font-[family-name:var(--font-mono)]">
                Failed — try again
              </span>
            )}
            {isStreaming ? (
              <button
                onClick={stopGeneration}
                className="flex items-center gap-1.5 text-[9px] text-text-faint font-[family-name:var(--font-mono)] bg-surface px-1.5 py-1 rounded-[4px] border border-border-strong hover:text-text-secondary transition-colors"
                title="Stop (Esc)"
              >
                <Square size={8} className="fill-current" />
                stop
              </button>
            ) : (
              <kbd className="text-[9px] text-text-faint font-[family-name:var(--font-mono)] bg-surface px-1.5 py-1 rounded-[4px] border border-border-strong">
                {loading ? "..." : "enter"}
              </kbd>
            )}
          </div>

          {isStreaming && (
            <div
              ref={streamContentRef}
              className="px-5 pb-4 pt-1 max-h-[320px] overflow-y-auto border-t border-gold-strong/30"
              style={{ animation: "fadeIn 0.15s ease-out" }}
            >
              <div
                className="prose-preview text-[15px] leading-[1.75] text-text-primary"
                dangerouslySetInnerHTML={{ __html: md.render(streamingText) }}
              />
            </div>
          )}

          {!isStreaming && (
            <div className="px-4 pb-2.5 -mt-1">
              <p className="text-[10px] text-text-faint italic pl-[26px]">
                This takes into consideration everything around it so don&apos;t worry.
              </p>
            </div>
          )}
        </div>
      )}
    </NodeViewWrapper>
  );
}
