"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { postCodexStart, postCodexToken, openExternal } from "@/lib/ai-client";
import { primeCodexRefreshToken } from "@/lib/codex-token-manager";
import { CODEX_DEVICE_VERIFY_URL } from "@/lib/codex-auth";

export type CodexSignInPhase = "idle" | "loading" | "code" | "polling";

/**
 * The OpenAI device-code flow for connecting Codex as an AI provider.
 *
 * "Sign in" here is OpenAI's own name for their device-code flow, not a
 * Fragment account: this hook stores `codexAccessToken`/`codexRefreshToken`
 * for routing AI calls and nothing else. It must never mint a Fragment
 * session — that credential's only job is AI routing.
 *
 * Extracted so both the Settings card and the global reconnect banner drive
 * the exact same logic. Flow: start() → shows a user code → openVerification()
 * opens OpenAI in the browser and begins polling → on success, credentials
 * are stored and `onConnected` fires.
 */
export function useCodexSignIn(onConnected?: () => void) {
  const updateProviderCredentials = useSettingsStore((s) => s.updateProviderCredentials);
  const setCodexConnection = useAppStore((s) => s.setCodexConnection);

  const [phase, setPhase] = useState<CodexSignInPhase>("idle");
  const [userCode, setUserCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deviceRef = useRef<{ deviceAuthId: string; userCode: string } | null>(null);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const start = useCallback(async () => {
    setError(null);
    setPhase("loading");
    try {
      const res = await postCodexStart();
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to start sign-in");
        setPhase("idle");
        return;
      }
      deviceRef.current = { deviceAuthId: data.deviceAuthId, userCode: data.userCode };
      setUserCode(data.userCode);
      setPhase("code");
    } catch {
      setError("Could not reach auth server");
      setPhase("idle");
    }
  }, []);

  const startPolling = useCallback(
    (deviceAuthId: string, code: string, interval: number) => {
      setPhase("polling");
      pollingRef.current = setInterval(async () => {
        try {
          const res = await postCodexToken(
            JSON.stringify({ deviceAuthId, userCode: code }),
          );
          const data = await res.json();

          if (data.status === "pending") return; // keep polling

          stopPolling();

          if (data.status === "success") {
            const refreshToken = data.refreshToken || "";
            updateProviderCredentials({
              codexAccessToken: data.accessToken,
              codexRefreshToken: refreshToken,
            });
            primeCodexRefreshToken(refreshToken);
            setCodexConnection("connected");

            // This credential is for routing AI calls through Codex, full
            // stop. It must never be used to sign in to Fragment or start a
            // sync session — that is Google's job (ARI-229), not this flow's.
            setPhase("idle");
            setError(null);
            onConnected?.();
          } else {
            setError(data.error || "Authentication failed");
            setPhase("idle");
          }
        } catch {
          stopPolling();
          setError("Polling failed");
          setPhase("idle");
        }
      }, interval * 1000);
    },
    [stopPolling, updateProviderCredentials, setCodexConnection, onConnected],
  );

  const openVerification = useCallback(() => {
    openExternal(CODEX_DEVICE_VERIFY_URL);
    if (deviceRef.current) {
      startPolling(deviceRef.current.deviceAuthId, deviceRef.current.userCode, 5);
    }
  }, [startPolling]);

  const cancel = useCallback(() => {
    stopPolling();
    deviceRef.current = null;
    setPhase("idle");
    setError(null);
  }, [stopPolling]);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [userCode]);

  return { phase, userCode, copied, error, start, openVerification, cancel, copy };
}
