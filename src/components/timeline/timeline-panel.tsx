"use client";

import { useState, useMemo } from "react";
import { Clock, PanelRightClose, Bookmark } from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useToastStore } from "@/hooks/use-toast";
import { VersionEntry } from "./version-entry";

function getDayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (target.getTime() === today.getTime()) return "Today";
  if (target.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getDayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function TimelinePanel() {
  const { activePieceId, setTimelineOpen, setTimelinePreviewVersionId } = useAppStore();
  const { versions, createVersion } = useDataStore();
  const showToast = useToastStore((s) => s.showToast);

  const [isNaming, setIsNaming] = useState(false);
  const [snapshotName, setSnapshotName] = useState("");

  const pieceVersions = useMemo(() => {
    return Object.values(versions)
      .filter((v) => v.pieceId === activePieceId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [versions, activePieceId]);

  const groupedVersions = useMemo(() => {
    const groups: { label: string; key: string; versions: typeof pieceVersions }[] = [];
    let currentKey = "";

    for (const v of pieceVersions) {
      const key = getDayKey(v.createdAt);
      if (key !== currentKey) {
        currentKey = key;
        groups.push({ label: getDayLabel(v.createdAt), key, versions: [] });
      }
      groups[groups.length - 1].versions.push(v);
    }
    return groups;
  }, [pieceVersions]);

  function handleClose() {
    setTimelineOpen(false);
    setTimelinePreviewVersionId(null);
  }

  function handleSaveSnapshot() {
    if (!activePieceId) return;

    if (!isNaming) {
      createVersion(activePieceId, "", "manual");
      showToast("Snapshot saved");
      return;
    }

    createVersion(activePieceId, snapshotName.trim(), "manual");
    showToast("Snapshot saved");
    setIsNaming(false);
    setSnapshotName("");
  }

  function handleNameKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSaveSnapshot();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setIsNaming(false);
      setSnapshotName("");
    }
  }

  return (
    <div className="flex flex-col h-full w-[340px] bg-surface rounded-[var(--radius-xl)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
        <div className="flex items-center gap-2.5">
          <Clock size={14} className="text-text-muted" />
          <span className="text-[10px] uppercase tracking-wider text-text-muted font-[family-name:var(--font-mono)]">
            Timeline
          </span>
          <span className="text-[10px] text-text-faint font-[family-name:var(--font-mono)]">
            {pieceVersions.length}
          </span>
        </div>
        <button
          onClick={handleClose}
          className="p-2 rounded-[var(--radius-default)] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {/* Save snapshot */}
      <div className="px-5 pb-4">
        {isNaming ? (
          <div
            className="flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-lg)] bg-surface-2 border border-border-strong"
            style={{ animation: "fadeIn 0.12s ease-out" }}
          >
            <Bookmark size={13} className="text-gold shrink-0" />
            <input
              type="text"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              placeholder="Name this snapshot..."
              className="flex-1 bg-transparent text-[12px] text-text-primary placeholder:text-text-faint outline-none"
              autoFocus
            />
            <kbd className="text-[9px] text-text-faint font-[family-name:var(--font-mono)] bg-surface px-1.5 py-0.5 rounded-[4px] border border-border-strong">
              enter
            </kbd>
          </div>
        ) : (
          <button
            onClick={handleSaveSnapshot}
            className="flex items-center gap-3 w-full px-4 py-3 rounded-[var(--radius-lg)] text-[12px] font-medium
              bg-surface-2 text-text-secondary border border-border-strong
              hover:bg-surface-3 hover:text-text-primary hover:border-gold/20 transition-all duration-150"
          >
            <Bookmark size={14} strokeWidth={2} />
            Save snapshot
          </button>
        )}
      </div>

      {/* Version list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {pieceVersions.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <Clock size={24} className="mx-auto mb-3 text-text-faint opacity-40" />
            <p className="text-[13px] text-text-muted">No snapshots yet</p>
            <p className="text-[12px] text-text-faint mt-2">
              Save a snapshot or export to start tracking versions
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {groupedVersions.map((group) => (
              <div key={group.key}>
                <div className="flex items-center gap-3 px-4 py-2 mt-2 first:mt-0">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[9px] uppercase tracking-wider text-text-faint font-[family-name:var(--font-mono)]">
                    {group.label}
                  </span>
                  <div className="flex-1 h-px bg-border" />
                </div>
                {group.versions.map((v) => (
                  <VersionEntry key={v.id} version={v} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
