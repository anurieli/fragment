"use client";

import { Clock, RotateCcw } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useToastStore } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";

export function VersionPreviewBanner() {
  const { timelinePreviewVersionId, setTimelinePreviewVersionId } = useAppStore();
  const { versions, restoreVersion } = useDataStore();
  const showToast = useToastStore((s) => s.showToast);

  if (!timelinePreviewVersionId) return null;

  const version = versions[timelinePreviewVersionId];
  if (!version) return null;

  function handleRestore() {
    restoreVersion(timelinePreviewVersionId!);
    setTimelinePreviewVersionId(null);
    showToast("Version restored. Previous state saved.");
  }

  function handleBack() {
    setTimelinePreviewVersionId(null);
  }

  return (
    <div
      className="flex items-center justify-between px-8 py-3 bg-gold-muted border-b border-gold-strong shrink-0"
      style={{ animation: "fadeIn 0.15s ease-out" }}
    >
      <div className="flex items-center gap-2.5">
        <Clock size={13} className="text-gold shrink-0" />
        <span className="text-[12px] text-text-primary font-medium truncate max-w-[200px]">
          {version.name}
        </span>
        <span className="text-[10px] text-text-muted font-[family-name:var(--font-mono)]">
          {formatDate(version.createdAt)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={handleBack}
          className="px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150 font-[family-name:var(--font-mono)]"
        >
          Back to current
        </button>
        <button
          onClick={handleRestore}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] text-[11px] font-medium text-gold bg-gold-muted border border-gold-strong hover:bg-gold-strong transition-all duration-150"
        >
          <RotateCcw size={11} />
          <span className="font-[family-name:var(--font-mono)]">Restore</span>
        </button>
      </div>
    </div>
  );
}
