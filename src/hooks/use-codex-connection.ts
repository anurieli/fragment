"use client";

import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { ensureValidCodexToken, primeCodexRefreshToken } from "@/lib/codex-token-manager";

/** How often to proactively check/refresh the Codex token while the app runs. */
const CHECK_INTERVAL_MS = 4 * 60_000;

/**
 * Keeps the "Sign in with ChatGPT" (Codex) session warm so it rarely lapses
 * during use. Periodically — and whenever the window regains focus — it asks
 * the token manager to refresh if the access token is near expiry. The token
 * manager only ends the session on a definitive `invalid_grant`, so transient
 * network blips never trigger a spurious disconnect.
 */
export function useCodexConnection() {
  useEffect(() => {
    const check = () => {
      const store = useSettingsStore.getState();
      const { codexAccessToken, codexRefreshToken } = store.settings.providerCredentials;

      // Only manage a session that actually exists.
      if (!codexAccessToken && !codexRefreshToken) return;

      primeCodexRefreshToken(codexRefreshToken || "");
      ensureValidCodexToken(
        codexAccessToken || "",
        codexRefreshToken || "",
        store.updateProviderCredentials,
      ).then((token) => {
        // A live token with no recorded disconnect means we're connected.
        if (token) useAppStore.getState().setCodexConnection("connected");
      }).catch(() => {
        /* transient — manager keeps tokens; next tick retries */
      });
    };

    // Defer the first check so settings have hydrated from storage.
    const initial = setTimeout(check, 1500);
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
