"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, ExternalLink, CalendarClock, Send, CheckCircle2 } from "lucide-react";
import type { ContentFormat, ContentPiece } from "@/lib/content-engine";
import type { PublishPlatform } from "@/lib/publish";
import { copyForPlatform, openComposer } from "@/lib/publish";
import { useContentStore } from "@/stores/content-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/hooks/use-toast";

const COPY_TOAST = "Copied — whitespace preserved.";

/** Maps a piece's authoring format to the publish-platform its Share items
 * target. `essay` (a long-ish body kept short-form) shares Substack's
 * semantics; `other`/`script` have no platform-specific copy/composer. */
function resolveSharePlatform(format: ContentFormat): PublishPlatform | null {
  switch (format) {
    case "tweet":
      return "tweet";
    case "linkedin":
      return "linkedin";
    case "substack":
    case "essay":
      return "substack";
    default:
      return null;
  }
}

const PLATFORM_COPY_LABEL: Record<PublishPlatform, string> = {
  tweet: "Copy for X",
  linkedin: "Copy for LinkedIn",
  substack: "Copy for Substack",
  html: "Copy as HTML",
};

interface MenuButtonProps {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}

function MenuButton({ onClick, disabled, title, children }: MenuButtonProps) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-[12px] text-left transition-colors duration-150 ${
        disabled
          ? "text-text-faint cursor-not-allowed opacity-50"
          : "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
      }`}
    >
      {children}
    </button>
  );
}

interface PieceShareMenuProps {
  piece: ContentPiece;
}

/**
 * The per-piece Share ▾ menu (footer of PieceCard): platform-appropriate
 * copy/composer actions, "Mark ready & copy", the Substack verified-publish
 * loop's "Publish to Substack", a manual "Mark as published…" escape hatch,
 * and "Schedule…". Returns `null` entirely for `script` pieces — scripts
 * are never published (see the ARI-158 spec).
 */
export function PieceShareMenu({ piece }: PieceShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePiece = useContentStore((s) => s.updatePiece);
  const setPieceStatus = useContentStore((s) => s.setPieceStatus);
  const substackPublicationUrl = useSettingsStore((s) => s.settings.userProfile.substackPublicationUrl);
  const showToast = useToastStore((s) => s.showToast);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setManualFormOpen(false);
        setScheduleFormOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (piece.format === "script") return null;

  const platform = resolveSharePlatform(piece.format);
  const body = piece.body ?? "";
  const hasPub = Boolean(substackPublicationUrl?.trim());
  const isSubstack = platform === "substack";

  function closeAll() {
    setOpen(false);
    setManualFormOpen(false);
    setScheduleFormOpen(false);
  }

  function handleCopy() {
    if (!platform) return;
    void copyForPlatform(body, platform).then(() => showToast(COPY_TOAST));
    closeAll();
  }

  function handleOpenComposer() {
    if (platform === "tweet") {
      openComposer("tweet", { text: body });
    } else if (platform === "substack" && hasPub) {
      openComposer("substack", { publicationUrl: substackPublicationUrl });
    }
    closeAll();
  }

  function handleMarkReadyAndCopy() {
    setPieceStatus(piece.id, "ready");
    if (platform) {
      void copyForPlatform(body, platform).then(() => showToast(`Marked ready. ${COPY_TOAST}`));
    } else {
      navigator.clipboard?.writeText(body).catch(() => {});
      showToast("Marked ready — copied.");
    }
    closeAll();
  }

  function handlePublishToSubstack() {
    if (!hasPub) return;
    // Open the composer synchronously (within the click gesture) before the
    // async clipboard write, so the popup isn't blocked — see
    // copyForPlatform's doc comment on user-gesture timing.
    openComposer("substack", { publicationUrl: substackPublicationUrl });
    void copyForPlatform(body, "substack");
    updatePiece(piece.id, { publishAttemptedAt: Date.now() });
    showToast("Copied. Opening Substack — Fragment will confirm once it's live.");
    closeAll();
  }

  function handleConfirmManualPublish() {
    const url = manualUrl.trim();
    setPieceStatus(piece.id, "published", {
      platform: piece.format,
      method: "manual",
      publishedAt: Date.now(),
      url: url || undefined,
      verified: Boolean(url),
    });
    showToast(url ? "Marked published." : "Marked published — no URL on file.");
    setManualUrl("");
    closeAll();
  }

  function handleConfirmSchedule() {
    const ts = scheduleValue ? new Date(scheduleValue).getTime() : undefined;
    updatePiece(piece.id, { scheduledAt: Number.isFinite(ts) ? ts : undefined });
    showToast(ts ? "Scheduled." : "Schedule cleared.");
    setScheduleValue("");
    closeAll();
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1 px-2.5 py-1 rounded-[var(--radius-sm)] text-[11px] text-text-muted hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
      >
        Share
        <ChevronDown size={10} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-20 w-64 bg-surface-3 border border-border-strong rounded-[var(--radius-default)] shadow-xl py-1"
          style={{ animation: "fadeIn 0.12s ease-out" }}
        >
          {platform && (
            <MenuButton onClick={handleCopy}>
              <Copy size={13} className="shrink-0" />
              <span className="flex-1">{PLATFORM_COPY_LABEL[platform]}</span>
            </MenuButton>
          )}

          {platform === "tweet" && (
            <MenuButton onClick={handleOpenComposer}>
              <ExternalLink size={13} className="shrink-0" />
              <span className="flex-1">Open X composer</span>
            </MenuButton>
          )}

          {isSubstack && (
            <MenuButton
              onClick={handleOpenComposer}
              disabled={!hasPub}
              title={hasPub ? undefined : "Set your Substack publication URL in Settings → Profile first"}
            >
              <ExternalLink size={13} className="shrink-0" />
              <span className="flex-1">Open Substack editor</span>
            </MenuButton>
          )}

          <div className="mx-3 my-1 border-t border-border" />

          <MenuButton onClick={handleMarkReadyAndCopy}>
            <CheckCircle2 size={13} className="shrink-0" />
            <span className="flex-1">Mark ready & copy</span>
          </MenuButton>

          {isSubstack && (
            <MenuButton
              onClick={handlePublishToSubstack}
              disabled={!hasPub}
              title={hasPub ? undefined : "Set your Substack publication URL in Settings → Profile first"}
            >
              <Send size={13} className="shrink-0" />
              <span className="flex-1">Publish to Substack</span>
            </MenuButton>
          )}

          {isSubstack && !hasPub && (
            <p className="px-3 pt-0.5 pb-1 text-[10px] text-text-faint leading-snug">
              Set your Substack publication URL in Settings → Profile to enable these.
            </p>
          )}

          <div className="mx-3 my-1 border-t border-border" />

          <MenuButton
            onClick={() => {
              setManualFormOpen((v) => !v);
              setScheduleFormOpen(false);
            }}
          >
            <span className="flex-1">Mark as published…</span>
          </MenuButton>
          {manualFormOpen && (
            <div className="px-3 pb-2 pt-1 space-y-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="Published URL (optional)"
                className="w-full bg-surface-2 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-text-primary placeholder:text-text-faint outline-none focus:border-border-active"
              />
              <p className="text-[10px] text-text-faint leading-snug">
                Marks this piece published now, without waiting for verification.
              </p>
              <button
                onClick={handleConfirmManualPublish}
                className="w-full px-2 py-1 rounded-[var(--radius-sm)] text-[11px] text-text-primary bg-surface-2 hover:bg-surface-hover transition-colors duration-150"
              >
                Confirm
              </button>
            </div>
          )}

          <MenuButton
            onClick={() => {
              setScheduleFormOpen((v) => !v);
              setManualFormOpen(false);
            }}
          >
            <CalendarClock size={13} className="shrink-0" />
            <span className="flex-1">Schedule…</span>
          </MenuButton>
          {scheduleFormOpen && (
            <div className="px-3 pb-2 pt-1 space-y-1.5" onClick={(e) => e.stopPropagation()}>
              <input
                type="datetime-local"
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
                className="w-full bg-surface-2 border border-border-strong rounded-[var(--radius-sm)] px-2 py-1 text-[11px] text-text-primary outline-none focus:border-border-active"
              />
              <button
                onClick={handleConfirmSchedule}
                className="w-full px-2 py-1 rounded-[var(--radius-sm)] text-[11px] text-text-primary bg-surface-2 hover:bg-surface-hover transition-colors duration-150"
              >
                {scheduleValue ? "Set schedule" : "Clear schedule"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
