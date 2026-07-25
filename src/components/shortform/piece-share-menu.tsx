"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Copy, ExternalLink, CalendarClock, Send, CheckCircle2, Mail } from "lucide-react";
import type { ContentFormat, ContentPiece } from "@/lib/content-engine";
import type { PublishPlatform } from "@/lib/publish";
import {
  copyForPlatform,
  openComposer,
  canPublishToKit,
  isKitEligibleFormat,
  createKitBroadcast,
  deriveKitSubject,
  markdownToCleanHtml,
} from "@/lib/publish";
import { canPublishToLinkedIn, publishLinkedInPost, ComposioApiError } from "@/lib/composio/linkedin";
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
 * loop's "Publish to Substack", one-click "Publish to Kit (draft)" /
 * "Schedule on Kit" (ARI-164, substack/essay/other formats only — see
 * `isKitEligibleFormat`), a manual "Mark as published…" escape hatch, and
 * "Schedule…". Returns `null` entirely for `script` pieces — scripts are
 * never published (see the ARI-158 spec).
 */
export function PieceShareMenu({ piece }: PieceShareMenuProps) {
  const [open, setOpen] = useState(false);
  const [manualFormOpen, setManualFormOpen] = useState(false);
  const [manualUrl, setManualUrl] = useState("");
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);
  const [scheduleValue, setScheduleValue] = useState("");
  const [kitBusy, setKitBusy] = useState<"draft" | "schedule" | null>(null);
  const [linkedinBusy, setLinkedinBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const updatePiece = useContentStore((s) => s.updatePiece);
  const setPieceStatus = useContentStore((s) => s.setPieceStatus);
  const substackPublicationUrl = useSettingsStore((s) => s.settings.userProfile.substackPublicationUrl);
  const kitApiKey = useSettingsStore((s) => s.settings.userProfile.kitApiKey);
  const composioApiKey = useSettingsStore((s) => s.settings.userProfile.composioApiKey);
  const linkedInConnectedAccountId = useSettingsStore(
    (s) => s.settings.userProfile.linkedInConnectedAccountId,
  );
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
  const hasKitKey = Boolean(kitApiKey?.trim());
  const kitEligible = isKitEligibleFormat(piece.format);
  const canKitPublish = canPublishToKit(piece.format, kitApiKey);
  const isLinkedIn = platform === "linkedin";
  const canLinkedInPublish = isLinkedIn && canPublishToLinkedIn(composioApiKey, linkedInConnectedAccountId);

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

  // Draft vs schedule on Kit are deliberately asymmetric (ARI-164):
  //   - "Publish to Kit (draft)" creates a Kit draft (no send_at). A draft
  //     isn't live, so Fragment's own status does NOT flip to "published" —
  //     only publishAttemptedAt is stamped, which lights up the same
  //     "awaiting confirmation" badge the Substack verified-publish loop
  //     uses (see publishPendingState in src/lib/publish/substack-verify.ts).
  //   - "Schedule on Kit" sends send_at (from piece.scheduledAt), which Kit
  //     will actually deliver on its own — that IS a publish commitment, so
  //     status flips to "published" with a verified:true PublishRecord. The
  //     API response succeeding is the verification; there's no separate
  //     confirmation loop for Kit the way there is for Substack's RSS feed.
  async function handlePublishToKitDraft() {
    if (!canKitPublish || kitBusy) return;
    setKitBusy("draft");
    try {
      const result = await createKitBroadcast({
        apiKey: kitApiKey,
        subject: deriveKitSubject(piece.title, body),
        contentHtml: markdownToCleanHtml(body),
      });
      updatePiece(piece.id, { publishAttemptedAt: Date.now() });
      showToast(`Draft created in Kit — finish it there: ${result.url}`);
      closeAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't create the Kit draft.");
    } finally {
      setKitBusy(null);
    }
  }

  async function handleScheduleOnKit() {
    if (!canKitPublish || !piece.scheduledAt || kitBusy) return;
    setKitBusy("schedule");
    try {
      const result = await createKitBroadcast({
        apiKey: kitApiKey,
        subject: deriveKitSubject(piece.title, body),
        contentHtml: markdownToCleanHtml(body),
        sendAt: piece.scheduledAt,
      });
      setPieceStatus(piece.id, "published", {
        platform: piece.format,
        method: "kit",
        url: result.url,
        publishedAt: Date.now(),
        verified: true,
      });
      showToast("Scheduled on Kit.");
      closeAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Couldn't schedule on Kit.");
    } finally {
      setKitBusy(null);
    }
  }

  // Publishing succeeds/fails in one round trip (unlike Kit's draft-vs-schedule
  // split) — a successful Composio create-post call means the post is live on
  // LinkedIn right now, so this always flips status straight to "published"
  // with verified:true. Errors (including an expired/revoked connection) are
  // never silent: ComposioApiError's message already names the fix (reconnect
  // in Settings → Integrations), so the toast alone is the hint.
  async function handlePublishToLinkedIn() {
    if (!canLinkedInPublish || linkedinBusy) return;
    setLinkedinBusy(true);
    try {
      const result = await publishLinkedInPost(composioApiKey, linkedInConnectedAccountId, body);
      setPieceStatus(piece.id, "published", {
        platform: piece.format,
        method: "composio",
        url: result.url,
        publishedAt: Date.now(),
        verified: true,
      });
      showToast(result.url ? `Published to LinkedIn: ${result.url}` : "Published to LinkedIn.");
      closeAll();
    } catch (err) {
      showToast(err instanceof ComposioApiError ? err.message : "Couldn't publish to LinkedIn.");
    } finally {
      setLinkedinBusy(false);
    }
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

          {isLinkedIn && (
            <MenuButton
              onClick={handlePublishToLinkedIn}
              disabled={!canLinkedInPublish || linkedinBusy}
              title={canLinkedInPublish ? undefined : "Connect LinkedIn in Settings → Integrations"}
            >
              <Send size={13} className="shrink-0" />
              <span className="flex-1">{linkedinBusy ? "Publishing…" : "Publish to LinkedIn"}</span>
            </MenuButton>
          )}
          {isLinkedIn && !canLinkedInPublish && (
            <p className="px-3 pt-0.5 pb-1 text-[10px] text-text-faint leading-snug">
              Connect LinkedIn in Settings → Integrations to enable this.
            </p>
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

          {kitEligible && (
            <MenuButton
              onClick={handlePublishToKitDraft}
              disabled={!canKitPublish || kitBusy !== null}
              title={hasKitKey ? undefined : "Add your Kit API key in Settings → Profile first"}
            >
              <Mail size={13} className="shrink-0" />
              <span className="flex-1">
                {kitBusy === "draft" ? "Creating draft…" : "Publish to Kit (draft)"}
              </span>
            </MenuButton>
          )}

          {kitEligible && piece.scheduledAt !== undefined && (
            <MenuButton
              onClick={handleScheduleOnKit}
              disabled={!canKitPublish || kitBusy !== null}
              title={hasKitKey ? undefined : "Add your Kit API key in Settings → Profile first"}
            >
              <CalendarClock size={13} className="shrink-0" />
              <span className="flex-1">{kitBusy === "schedule" ? "Scheduling…" : "Schedule on Kit"}</span>
            </MenuButton>
          )}

          {kitEligible && !hasKitKey && (
            <p className="px-3 pt-0.5 pb-1 text-[10px] text-text-faint leading-snug">
              Add your Kit API key in Settings → Profile to enable these.
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
