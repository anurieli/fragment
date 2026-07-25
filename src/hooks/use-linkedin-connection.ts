"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { openExternal } from "@/lib/ai-client";
import {
  initiateLinkedInConnection,
  getConnectionStatus,
  ComposioApiError,
  type LinkedInConnectionStatus,
} from "@/lib/composio/linkedin";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60_000;

export type LinkedInConnectPhase = "idle" | "connecting" | "polling" | "checking";

interface LinkedInConnectionState {
  phase: LinkedInConnectPhase;
  /** Last known status for the stored connectedAccountId, or "unknown" before the first check. */
  status: LinkedInConnectionStatus | "unknown";
  accountLabel?: string;
  error: string | null;
}

/**
 * Drives the "Connect LinkedIn" flow in Settings → Integrations: opens
 * Composio's hosted Connect Link page, then polls `getConnectionStatus`
 * until it reports `"active"`, capped at 5 minutes and paused while the tab
 * is hidden (no point burning requests against a backgrounded window — the
 * user has to be looking at the browser tab Composio's grant page opened
 * anyway). Also does a one-shot status check on mount when a
 * `connectedAccountId` is already stored, so a reconnect/expiry shows up
 * without the user having to click anything.
 */
export function useLinkedInConnection() {
  const composioApiKey = useSettingsStore((s) => s.settings.userProfile.composioApiKey);
  const connectedAccountId = useSettingsStore((s) => s.settings.userProfile.linkedInConnectedAccountId);
  const updateUserProfile = useSettingsStore((s) => s.updateUserProfile);

  const [state, setState] = useState<LinkedInConnectionState>({
    phase: "idle",
    status: "unknown",
    error: null,
  });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollDeadlineRef = useRef<number>(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const checkStatus = useCallback(
    async (accountId: string) => {
      try {
        const result = await getConnectionStatus(composioApiKey, accountId);
        setState((s) => ({ ...s, status: result.status, accountLabel: result.accountLabel, error: null }));
        return result.status;
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof ComposioApiError ? err.message : "Couldn't check LinkedIn connection status.",
        }));
        return "unknown" as const;
      }
    },
    [composioApiKey],
  );

  // One-shot status check on mount / whenever the stored account changes —
  // surfaces an expired/revoked connection without requiring a click.
  useEffect(() => {
    if (!connectedAccountId || !composioApiKey) return;
    setState((s) => ({ ...s, phase: "checking" }));
    void checkStatus(connectedAccountId).finally(() => {
      setState((s) => (s.phase === "checking" ? { ...s, phase: "idle" } : s));
    });
    // Only re-run when the identity of the connection changes, not on every
    // composioApiKey keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAccountId]);

  const startPolling = useCallback(
    (accountId: string) => {
      stopPolling();
      pollDeadlineRef.current = Date.now() + POLL_TIMEOUT_MS;
      setState((s) => ({ ...s, phase: "polling", error: null }));

      pollRef.current = setInterval(async () => {
        if (Date.now() > pollDeadlineRef.current) {
          stopPolling();
          setState((s) => ({
            ...s,
            phase: "idle",
            error: "Didn't detect the connection within 5 minutes — try again.",
          }));
          return;
        }
        // Visibility-gated: skip the network call while the tab is hidden,
        // but keep counting down the 5-minute deadline regardless.
        if (typeof document !== "undefined" && document.hidden) return;

        const status = await checkStatus(accountId);
        if (status === "active") {
          stopPolling();
          setState((s) => ({ ...s, phase: "idle" }));
        } else if (status === "expired" || status === "revoked" || status === "failed") {
          stopPolling();
          setState((s) => ({ ...s, phase: "idle" }));
        }
      }, POLL_INTERVAL_MS);
    },
    [checkStatus, stopPolling],
  );

  const connect = useCallback(async () => {
    if (!composioApiKey.trim()) {
      setState((s) => ({ ...s, error: "Add your Composio API key first." }));
      return;
    }
    setState((s) => ({ ...s, phase: "connecting", error: null }));
    try {
      const { redirectUrl, connectedAccountId: newId } = await initiateLinkedInConnection(composioApiKey);
      updateUserProfile({ linkedInConnectedAccountId: newId });
      await openExternal(redirectUrl);
      startPolling(newId);
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "idle",
        error: err instanceof ComposioApiError ? err.message : "Couldn't start the LinkedIn connection.",
      }));
    }
  }, [composioApiKey, startPolling, updateUserProfile]);

  const disconnect = useCallback(() => {
    stopPolling();
    updateUserProfile({ linkedInConnectedAccountId: "" });
    setState({ phase: "idle", status: "unknown", error: null });
  }, [stopPolling, updateUserProfile]);

  return {
    ...state,
    connectedAccountId,
    hasApiKey: Boolean(composioApiKey.trim()),
    connect,
    reconnect: connect,
    disconnect,
  };
}
