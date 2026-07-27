"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  X,
  Mic,
  MicOff,
  Monitor,
  Camera,
  Send,
  Loader2,
  Bug,
  Lightbulb,
  MessageSquare,
  Square,
  ChevronUp,
} from "lucide-react";
import { useAppStore } from "@/stores/app-store";
import { useToastStore } from "@/hooks/use-toast";
import { captureEvent } from "@/lib/posthog";
import { useDeviceId } from "@/hooks/use-device-id";
import { generateId } from "@/lib/utils";
import { submitFeedback } from "@/lib/cloud-client";
import type { FeedbackType, FeedbackQueueItem } from "@/lib/types";
import { useMediaCapture } from "./use-media-capture";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildMetadata(activeNoteId: string | null) {
  return {
    appVersion: "1.0.0",
    platform: typeof navigator !== "undefined" ? navigator.platform : "unknown",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
    timestamp: new Date().toISOString(),
    screenResolution:
      typeof window !== "undefined"
        ? `${window.screen.width}x${window.screen.height}`
        : "unknown",
    ...(activeNoteId ? { activeNoteId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Category pill
// ---------------------------------------------------------------------------

function CategoryPill({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all duration-150 ${
        active
          ? "bg-gold/15 text-gold border border-gold/30"
          : "bg-surface-2 text-text-muted border border-border hover:bg-surface-3 hover:text-text-secondary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Attachment badge
// ---------------------------------------------------------------------------

function AttachmentBadge({
  icon,
  label,
  onRemove,
}: {
  icon: React.ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-sm)] bg-surface-2 border border-border text-[10px] text-text-secondary font-[family-name:var(--font-mono)]">
      {icon}
      <span>{label}</span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 text-text-faint hover:text-red transition-colors duration-100"
      >
        <X size={10} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Media action button
// ---------------------------------------------------------------------------

function MediaBtn({
  icon,
  activeIcon,
  tooltip,
  isActive = false,
  onClick,
  disabled = false,
  unavailable = false,
  pulse = false,
}: {
  icon: React.ReactNode;
  activeIcon?: React.ReactNode;
  tooltip: string;
  isActive?: boolean;
  onClick: () => void;
  disabled?: boolean;
  unavailable?: boolean;
  pulse?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || unavailable}
      title={unavailable ? `${tooltip} (unavailable in desktop app)` : tooltip}
      className={`relative flex items-center justify-center w-8 h-8 rounded-[var(--radius-default)] transition-all duration-150
        ${disabled || unavailable ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}
        ${isActive
          ? "bg-red-muted text-red border border-red/30"
          : "bg-surface-2 text-text-muted border border-border hover:bg-surface-3 hover:text-text-secondary"
        }`}
    >
      {isActive && activeIcon ? activeIcon : icon}
      {pulse && isActive && (
        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-red animate-pulse" />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Compact recording bar — shown at bottom of sidebar during recording
// ---------------------------------------------------------------------------

export function FeedbackRecordingBar({
  media,
  onExpand,
}: {
  media: ReturnType<typeof useMediaCapture>;
  onExpand: () => void;
}) {
  const isVoice = media.voiceState === "recording";
  const isScreen = media.screenState === "recording";

  if (!isVoice && !isScreen) return null;

  return (
    <div className="mx-3 mb-3 flex items-center gap-2.5 px-3 py-2.5 rounded-[var(--radius-lg)] bg-surface-2 border border-red/20 animate-[slideInFromLeft_0.15s_ease-out]">
      <span className="w-2 h-2 rounded-full bg-red animate-pulse shrink-0" />
      <span className="flex-1 text-[11px] text-text-secondary truncate">
        {isVoice && `Recording voice ${formatDuration(media.voiceDurationSeconds)}`}
        {isScreen && `Recording screen ${formatDuration(media.screenDurationSeconds)}/0:30`}
      </span>
      <button
        type="button"
        onClick={() => {
          if (isVoice) media.stopVoiceRecording();
          if (isScreen) media.stopScreenRecording();
        }}
        className="p-1 rounded-[var(--radius-sm)] bg-red-muted text-red hover:bg-red/20 transition-colors"
        title="Stop recording"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        onClick={onExpand}
        className="p-1 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-3 transition-colors"
        title="Back to feedback"
      >
        <ChevronUp size={12} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main feedback panel — renders inside sidebar
// ---------------------------------------------------------------------------

export function FeedbackPanel() {
  const closeFeedback = useAppStore((s) => s.closeFeedback);
  const activeNoteId = useAppStore((s) => s.activeNoteId);
  const showToast = useToastStore((s) => s.showToast);
  const deviceId = useDeviceId();

  const [type, setType] = useState<FeedbackType>("feedback");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const media = useMediaCapture();

  // Auto-focus textarea on open
  useEffect(() => {
    const timer = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(80, el.scrollHeight)}px`;
  }, [message]);

  const hasContent =
    message.trim().length > 0 ||
    media.attachments.voiceNote !== null ||
    media.attachments.screenRecording !== null ||
    media.attachments.screenshot !== null;

  const handleVoiceToggle = useCallback(() => {
    if (media.voiceState === "recording") media.stopVoiceRecording();
    else if (media.voiceState === "idle") void media.startVoiceRecording();
  }, [media]);

  const handleScreenToggle = useCallback(() => {
    if (media.screenState === "recording") media.stopScreenRecording();
    else if (media.screenState === "idle") void media.startScreenRecording();
  }, [media]);

  const handleScreenshot = useCallback(() => {
    if (media.screenshotState === "idle") void media.captureScreenshot();
    else if (media.screenshotState === "done") media.clearScreenshot();
  }, [media]);

  const handleSubmit = useCallback(async () => {
    if (!hasContent || isSubmitting) return;
    setIsSubmitting(true);

    const item: FeedbackQueueItem = {
      id: generateId(),
      type,
      message: message.trim(),
      screenshot: media.attachments.screenshot ?? undefined,
      screenRecording: media.attachments.screenRecording ?? undefined,
      voiceNote: media.attachments.voiceNote ?? undefined,
      metadata: buildMetadata(activeNoteId),
      status: "pending",
      createdAt: Date.now(),
    };

    try {
      // Save to local queue first
      try {
        const { db } = await import("@/lib/db");
        await db.feedbackQueue.put({ ...item, status: "pending" });
      } catch {
        // Local persistence failure is non-critical
      }

      await submitFeedback(
        deviceId,
        {
          type: item.type,
          message: item.message,
          platform: item.metadata.platform,
          appVersion: item.metadata.appVersion,
          screenResolution: item.metadata.screenResolution,
          userAgent: item.metadata.userAgent,
          activeNoteId: item.metadata.activeNoteId,
        },
        {
          screenshot: item.screenshot,
          screenRecording: item.screenRecording,
          voiceNote: item.voiceNote,
        },
      );

      try {
        const { db } = await import("@/lib/db");
        await db.feedbackQueue.update(item.id, { status: "submitted", submittedAt: Date.now() });
      } catch { /* best-effort */ }

      media.clearAll();
      setMessage("");
      closeFeedback();
      showToast("Feedback sent — thank you!");
      captureEvent("feedback_submitted", { type });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Network error";
      try {
        const { db } = await import("@/lib/db");
        await db.feedbackQueue.update(item.id, { status: "failed", errorMessage: errMsg });
      } catch { /* best-effort */ }
      showToast("Failed to send feedback. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }, [hasContent, isSubmitting, type, message, media, activeNoteId, deviceId, closeFeedback, showToast]);

  const hasAttachments =
    media.attachments.voiceNote || media.attachments.screenRecording || media.attachments.screenshot;

  return (
    <div data-feedback-panel className="flex flex-col h-full animate-[slideInFromLeft_0.15s_ease-out]">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <div>
          <h2 className="text-[14px] font-semibold text-text-primary">Send Feedback</h2>
          <p className="text-[11px] text-text-muted mt-0.5">Bug reports, ideas, anything</p>
        </div>
        <button
          type="button"
          onClick={closeFeedback}
          className="p-1.5 rounded-[var(--radius-sm)] text-text-faint hover:text-text-secondary hover:bg-surface-2 transition-all duration-150"
        >
          <X size={15} />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-4 flex flex-col gap-3.5 min-h-0">
        {/* Category */}
        <div className="flex gap-2 flex-wrap">
          <CategoryPill label="Bug" icon={<Bug size={11} />} active={type === "bug"} onClick={() => setType("bug")} />
          <CategoryPill label="Feature" icon={<Lightbulb size={11} />} active={type === "feature"} onClick={() => setType("feature")} />
          <CategoryPill label="General" icon={<MessageSquare size={11} />} active={type === "feedback"} onClick={() => setType("feedback")} />
        </div>

        {/* Message */}
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What's on your mind?"
          rows={3}
          className="w-full resize-none rounded-[var(--radius-default)] bg-surface-2 border border-border
            text-[13px] text-text-primary placeholder:text-text-faint
            px-3.5 py-2.5 outline-none
            focus:border-border-active focus:bg-surface-3
            transition-colors duration-150
            font-[family-name:var(--font-body)]
            leading-relaxed"
          style={{ minHeight: "80px" }}
        />

        {/* Media buttons */}
        <div>
          <div className="flex items-center gap-2">
            <MediaBtn
              icon={<Mic size={14} />}
              activeIcon={<MicOff size={14} />}
              tooltip="Record your voice"
              isActive={media.voiceState === "recording"}
              onClick={handleVoiceToggle}
              disabled={media.voiceState === "done"}
              unavailable={!media.voiceAvailable}
              pulse={media.voiceState === "recording"}
            />
            <MediaBtn
              icon={<Monitor size={14} />}
              activeIcon={<Square size={14} />}
              tooltip="Record your screen"
              isActive={media.screenState === "recording"}
              onClick={handleScreenToggle}
              disabled={media.screenState === "done"}
              unavailable={!media.screenAvailable}
              pulse={media.screenState === "recording"}
            />
            <MediaBtn
              icon={<Camera size={14} />}
              tooltip="Take a screenshot"
              isActive={media.screenshotState === "capturing"}
              onClick={handleScreenshot}
              disabled={media.screenshotState === "capturing"}
            />

            {/* Live duration */}
            {media.voiceState === "recording" && (
              <span className="text-[10px] text-red font-[family-name:var(--font-mono)] tabular-nums ml-1">
                {formatDuration(media.voiceDurationSeconds)}
              </span>
            )}
            {media.screenState === "recording" && (
              <span className="text-[10px] text-red font-[family-name:var(--font-mono)] tabular-nums ml-1">
                {formatDuration(media.screenDurationSeconds)}/0:30
              </span>
            )}
          </div>

          {media.mediaError && (
            <p className="text-[11px] text-red mt-2 leading-snug">{media.mediaError}</p>
          )}
        </div>

        {/* Attachment badges */}
        {hasAttachments && (
          <div className="flex flex-wrap gap-2">
            {media.attachments.voiceNote && (
              <AttachmentBadge
                icon={<Mic size={10} />}
                label={`voice ${formatDuration(media.voiceDurationSeconds)}`}
                onRemove={media.clearVoice}
              />
            )}
            {media.attachments.screenRecording && (
              <AttachmentBadge
                icon={<Monitor size={10} />}
                label={`screen ${formatDuration(media.screenDurationSeconds)}`}
                onRemove={media.clearScreenRecording}
              />
            )}
            {media.attachments.screenshot && (
              <div className="flex items-center gap-2">
                {media.attachments.screenshotDataUrl && (
                  <img
                    src={media.attachments.screenshotDataUrl}
                    alt="Screenshot"
                    className="h-8 w-auto rounded-[var(--radius-sm)] border border-border object-cover"
                  />
                )}
                <AttachmentBadge
                  icon={<Camera size={10} />}
                  label="screenshot"
                  onRemove={media.clearScreenshot}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="px-5 pb-5 pt-2 shrink-0">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!hasContent || isSubmitting}
          className={`flex items-center justify-center gap-2 w-full px-4 py-2.5
            rounded-[var(--radius-lg)] text-[13px] font-medium transition-all duration-150
            ${hasContent && !isSubmitting
              ? "bg-gold text-bg hover:bg-gold-hover cursor-pointer"
              : "bg-surface-2 text-text-faint border border-border cursor-not-allowed"
            }`}
        >
          {isSubmitting ? (
            <><Loader2 size={14} className="animate-spin" /> Sending…</>
          ) : (
            <><Send size={14} /> Send Feedback</>
          )}
        </button>
      </div>
    </div>
  );
}
