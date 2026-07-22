"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Trash2, FileText } from "lucide-react";
import type { VoiceSample } from "@/lib/types";
import { generateId } from "@/lib/utils";
import { loadSamplesForVoice, saveSample, deleteSample } from "@/lib/persistence";
import { extractSampleText, SAMPLE_ACCEPT } from "@/lib/sample-extract";
import { useToastStore } from "@/hooks/use-toast";

interface VoiceSamplesManagerProps {
  voiceId: string;
  /** Called whenever samples change so the parent can mark the profile stale. */
  onSamplesChanged: () => void;
}

export function VoiceSamplesManager({ voiceId, onSamplesChanged }: VoiceSamplesManagerProps) {
  const [samples, setSamples] = useState<VoiceSample[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    loadSamplesForVoice(voiceId).then((rows) => {
      if (active) setSamples(rows);
    });
    return () => {
      active = false;
    };
  }, [voiceId]);

  const addSample = useCallback(
    async (title: string, text: string, source: VoiceSample["source"]) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const sample: VoiceSample = {
        id: generateId(),
        voiceId,
        title: title.trim() || "Untitled sample",
        source,
        text: trimmed,
        charCount: trimmed.length,
        createdAt: Date.now(),
      };
      await saveSample(sample);
      setSamples((prev) => [...prev, sample]);
      onSamplesChanged();
    },
    [voiceId, onSamplesChanged],
  );

  const handlePasteAdd = useCallback(async () => {
    if (!pasteText.trim()) return;
    const firstLine = pasteText.trim().split("\n")[0].slice(0, 60);
    await addSample(firstLine || "Pasted sample", pasteText, "paste");
    setPasteText("");
  }, [pasteText, addSample]);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          try {
            const { title, text } = await extractSampleText(file);
            await addSample(title, text, "file");
          } catch (err) {
            const message = err instanceof Error ? err.message : "Couldn't read that file.";
            useToastStore.getState().showToast(message);
          }
        }
      } finally {
        setBusy(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [addSample],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      await deleteSample(id);
      setSamples((prev) => prev.filter((s) => s.id !== id));
      onSamplesChanged();
    },
    [onSamplesChanged],
  );

  return (
    <div className="mb-8">
      <label className="block text-[11px] text-text-muted font-[family-name:var(--font-mono)] uppercase tracking-wider mb-1.5">
        Writing Samples
      </label>
      <p className="text-[10px] text-text-faint mb-3">
        Paste or upload examples of your writing. Fragment distills these into a compact
        voice profile using your configured AI provider — samples are only sent when you
        click Analyze.
      </p>

      {/* Paste box */}
      <textarea
        value={pasteText}
        onChange={(e) => setPasteText(e.target.value)}
        placeholder="Paste a piece of your writing here…"
        rows={5}
        className="w-full bg-surface-3 border border-border-strong rounded-[var(--radius-sm)] px-3 py-2 text-xs text-text-secondary font-[family-name:var(--font-body)] leading-relaxed outline-none focus:border-border-active transition-colors duration-150 resize-y placeholder:text-text-faint"
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={handlePasteAdd}
          disabled={!pasteText.trim()}
          className="px-3 py-1.5 rounded-[var(--radius-sm)] bg-surface-3 border border-border-strong text-[11px] text-text-secondary hover:text-text-primary hover:border-border-active transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Add sample
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] bg-surface-3 border border-border-strong text-[11px] text-text-secondary hover:text-text-primary hover:border-border-active transition-colors duration-150 disabled:opacity-40"
        >
          <Upload size={12} />
          {busy ? "Reading…" : "Upload file"}
        </button>
        <span className="text-[10px] text-text-faint">.md, .txt, .docx, .pdf</span>
        <input
          ref={fileInputRef}
          type="file"
          accept={SAMPLE_ACCEPT}
          multiple
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Sample rows */}
      {samples.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {samples.map((sample) => (
            <li
              key={sample.id}
              className="flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] bg-surface-2 border border-border"
            >
              <FileText size={13} className="text-text-faint shrink-0" />
              <span className="flex-1 min-w-0 truncate text-xs text-text-secondary">
                {sample.title}
              </span>
              <span className="text-[10px] text-text-faint shrink-0">
                {sample.charCount.toLocaleString()} chars
              </span>
              <button
                onClick={() => handleDelete(sample.id)}
                className="p-1 rounded text-text-faint hover:text-red-400 transition-colors duration-150 shrink-0"
                aria-label="Delete sample"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
