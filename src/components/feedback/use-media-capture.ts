"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VoiceRecordingState = "idle" | "recording" | "done";
export type ScreenRecordingState = "idle" | "recording" | "done";
export type ScreenshotState = "idle" | "capturing" | "done";

export interface MediaAttachments {
  voiceNote: Blob | null;
  screenRecording: Blob | null;
  screenshot: Blob | null;
  screenshotDataUrl: string | null;
}

export interface MediaCaptureControls {
  voiceState: VoiceRecordingState;
  voiceDurationSeconds: number;
  voiceAvailable: boolean;
  startVoiceRecording: () => Promise<void>;
  stopVoiceRecording: () => void;
  clearVoice: () => void;

  screenState: ScreenRecordingState;
  screenDurationSeconds: number;
  screenAvailable: boolean;
  startScreenRecording: () => Promise<void>;
  stopScreenRecording: () => void;
  clearScreenRecording: () => void;

  screenshotState: ScreenshotState;
  captureScreenshot: () => Promise<void>;
  clearScreenshot: () => void;

  attachments: MediaAttachments;
  isRecording: boolean;
  clearAll: () => void;
  mediaError: string | null;
  clearMediaError: () => void;
}

const MAX_SCREEN_RECORDING_SECONDS = 30;

// ---------------------------------------------------------------------------
// Capability detection
// ---------------------------------------------------------------------------

function hasGetUserMedia(): boolean {
  return typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function";
}

function hasGetDisplayMedia(): boolean {
  return typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getDisplayMedia === "function";
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMediaCapture(): MediaCaptureControls {
  const [voiceState, setVoiceState] = useState<VoiceRecordingState>("idle");
  const [voiceDurationSeconds, setVoiceDurationSeconds] = useState(0);
  const [voiceNote, setVoiceNote] = useState<Blob | null>(null);

  const [screenState, setScreenState] = useState<ScreenRecordingState>("idle");
  const [screenDurationSeconds, setScreenDurationSeconds] = useState(0);
  const [screenRecording, setScreenRecording] = useState<Blob | null>(null);

  const [screenshotState, setScreenshotState] = useState<ScreenshotState>("idle");
  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [screenshotDataUrl, setScreenshotDataUrl] = useState<string | null>(null);

  const [mediaError, setMediaError] = useState<string | null>(null);

  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);
  const voiceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);

  const screenRecorderRef = useRef<MediaRecorder | null>(null);
  const screenChunksRef = useRef<Blob[]>([]);
  const screenTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const voiceAvailable = hasGetUserMedia();
  const screenAvailable = hasGetDisplayMedia();

  useEffect(() => {
    return () => {
      if (voiceTimerRef.current) clearInterval(voiceTimerRef.current);
      if (screenTimerRef.current) clearInterval(screenTimerRef.current);
      if (voiceRecorderRef.current?.state === "recording") voiceRecorderRef.current.stop();
      if (screenRecorderRef.current?.state === "recording") screenRecorderRef.current.stop();
      if (voiceStreamRef.current) voiceStreamRef.current.getTracks().forEach((t) => t.stop());
      if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // -------------------------------------------------------------------------
  // Voice recording
  // -------------------------------------------------------------------------

  const startVoiceRecording = useCallback(async () => {
    setMediaError(null);
    if (!hasGetUserMedia()) {
      setMediaError("Microphone not available in this environment. Try running in a browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;

      // Pick a supported mime type
      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : undefined;

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      voiceChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(voiceChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        setVoiceNote(blob);
        setVoiceState("done");
        stream.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        if (voiceTimerRef.current) {
          clearInterval(voiceTimerRef.current);
          voiceTimerRef.current = null;
        }
      };

      voiceRecorderRef.current = recorder;
      recorder.start(100);
      setVoiceState("recording");
      setVoiceDurationSeconds(0);

      voiceTimerRef.current = setInterval(() => {
        setVoiceDurationSeconds((s) => s + 1);
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Microphone access denied";
      setMediaError(`Voice recording failed: ${msg}`);
    }
  }, []);

  const stopVoiceRecording = useCallback(() => {
    if (voiceRecorderRef.current?.state === "recording") voiceRecorderRef.current.stop();
    if (voiceTimerRef.current) {
      clearInterval(voiceTimerRef.current);
      voiceTimerRef.current = null;
    }
  }, []);

  const clearVoice = useCallback(() => {
    stopVoiceRecording();
    setVoiceNote(null);
    setVoiceState("idle");
    setVoiceDurationSeconds(0);
  }, [stopVoiceRecording]);

  // -------------------------------------------------------------------------
  // Screen recording
  // -------------------------------------------------------------------------

  const startScreenRecording = useCallback(async () => {
    setMediaError(null);
    if (!hasGetDisplayMedia()) {
      setMediaError("Screen recording not available in this environment. Try running in a browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });

      screenStreamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : undefined;

      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      screenChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) screenChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(screenChunksRef.current, {
          type: recorder.mimeType || "video/webm",
        });
        setScreenRecording(blob);
        setScreenState("done");
        stream.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        if (screenTimerRef.current) {
          clearInterval(screenTimerRef.current);
          screenTimerRef.current = null;
        }
      };

      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        if (screenRecorderRef.current?.state === "recording") {
          screenRecorderRef.current.stop();
        }
      });

      screenRecorderRef.current = recorder;
      recorder.start(100);
      setScreenState("recording");
      setScreenDurationSeconds(0);

      let elapsed = 0;
      screenTimerRef.current = setInterval(() => {
        elapsed += 1;
        setScreenDurationSeconds(elapsed);
        if (elapsed >= MAX_SCREEN_RECORDING_SECONDS) {
          if (screenRecorderRef.current?.state === "recording") {
            screenRecorderRef.current.stop();
          }
          if (screenTimerRef.current) {
            clearInterval(screenTimerRef.current);
            screenTimerRef.current = null;
          }
        }
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Screen capture denied";
      setMediaError(`Screen recording failed: ${msg}`);
    }
  }, []);

  const stopScreenRecording = useCallback(() => {
    if (screenRecorderRef.current?.state === "recording") screenRecorderRef.current.stop();
    if (screenTimerRef.current) {
      clearInterval(screenTimerRef.current);
      screenTimerRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
  }, []);

  const clearScreenRecording = useCallback(() => {
    stopScreenRecording();
    setScreenRecording(null);
    setScreenState("idle");
    setScreenDurationSeconds(0);
  }, [stopScreenRecording]);

  // -------------------------------------------------------------------------
  // Screenshot — uses modern-screenshot (supports modern CSS like lab/oklch)
  // -------------------------------------------------------------------------

  const captureScreenshot = useCallback(async () => {
    setMediaError(null);
    setScreenshotState("capturing");
    try {
      // Hide the feedback panel so it doesn't appear in the screenshot
      const feedbackEl = document.querySelector<HTMLElement>("[data-feedback-panel]");
      if (feedbackEl) feedbackEl.style.visibility = "hidden";

      const { domToPng, domToDataUrl } = await import("modern-screenshot");
      const [blob, dataUrl] = await Promise.all([
        domToPng(document.body, { scale: 1 }).then(
          (dataUri) => fetch(dataUri).then((r) => r.blob()),
        ),
        domToDataUrl(document.body, { scale: 1 }),
      ]);

      // Restore feedback panel visibility
      if (feedbackEl) feedbackEl.style.visibility = "";

      if (blob && blob.size > 0) {
        setScreenshot(blob);
        setScreenshotDataUrl(dataUrl);
        setScreenshotState("done");
      } else {
        setScreenshotState("idle");
        setMediaError("Failed to capture screenshot");
      }
    } catch (err) {
      // Restore feedback panel visibility on error
      const feedbackEl = document.querySelector<HTMLElement>("[data-feedback-panel]");
      if (feedbackEl) feedbackEl.style.visibility = "";
      setScreenshotState("idle");
      const msg = err instanceof Error ? err.message : "Screenshot capture failed";
      setMediaError(`Screenshot failed: ${msg}`);
    }
  }, []);

  const clearScreenshot = useCallback(() => {
    setScreenshot(null);
    setScreenshotDataUrl(null);
    setScreenshotState("idle");
  }, []);

  // -------------------------------------------------------------------------
  // Clear all
  // -------------------------------------------------------------------------

  const clearAll = useCallback(() => {
    clearVoice();
    clearScreenRecording();
    clearScreenshot();
    setMediaError(null);
  }, [clearVoice, clearScreenRecording, clearScreenshot]);

  const clearMediaError = useCallback(() => setMediaError(null), []);

  const isRecording = voiceState === "recording" || screenState === "recording";

  return {
    voiceState,
    voiceDurationSeconds,
    voiceAvailable,
    startVoiceRecording,
    stopVoiceRecording,
    clearVoice,

    screenState,
    screenDurationSeconds,
    screenAvailable,
    startScreenRecording,
    stopScreenRecording,
    clearScreenRecording,

    screenshotState,
    captureScreenshot,
    clearScreenshot,

    attachments: { voiceNote, screenRecording, screenshot, screenshotDataUrl },
    isRecording,
    clearAll,
    mediaError,
    clearMediaError,
  };
}
