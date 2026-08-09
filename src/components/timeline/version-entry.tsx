"use client";

import { Trash2, Copy } from "lucide-react";
import type { PieceVersion } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useToastStore } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";

interface VersionEntryProps {
  version: PieceVersion;
}

export function VersionEntry({ version }: VersionEntryProps) {
  const { timelinePreviewVersionId, setTimelinePreviewVersionId } = useAppStore();
  const { removeVersion, duplicateFromVersion } = useDataStore();
  const showToast = useToastStore((s) => s.showToast);

  const isActive = timelinePreviewVersionId === version.id;
  const isExport = version.trigger !== "manual";

  function handleClick() {
    if (isActive) {
      setTimelinePreviewVersionId(null);
    } else {
      setTimelinePreviewVersionId(version.id);
    }
  }

  function handleDelete() {
    if (isActive) {
      setTimelinePreviewVersionId(null);
    }
    removeVersion(version.id);
    showToast("Snapshot deleted");
  }

  function handleDuplicate() {
    const newId = duplicateFromVersion(version.id);
    if (newId) {
      showToast("Draft created from snapshot");
    }
  }

  return (
    <div
      className={`group relative flex items-start gap-3 px-4 py-3 rounded-[var(--radius-lg)] cursor-pointer transition-all duration-150 ${
        isActive ? "bg-gold-muted" : "hover:bg-surface-2"
      }`}
      onClick={handleClick}
    >
      {/* Dot indicator */}
      <div className="mt-1.5 shrink-0">
        {isExport ? (
          <div className="w-2.5 h-2.5 rounded-full border-[1.5px] border-gold" />
        ) : (
          <div className="w-2.5 h-2.5 rounded-full bg-gold" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-[12px] truncate ${isActive ? "text-text-primary font-medium" : "text-text-secondary"}`}>
            {version.name}
          </span>
          <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)] shrink-0">
            {formatDate(version.createdAt)}
          </span>
        </div>
        <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)]">
          {version.wordCount.toLocaleString()} words
        </span>
      </div>

      {/* Actions */}
      <div
        className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleDuplicate}
          className="p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-3 transition-all duration-150"
          title="Duplicate as new draft"
        >
          <Copy size={12} />
        </button>
        <button
          onClick={handleDelete}
          className="p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-red hover:bg-red-muted transition-all duration-150"
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}
