"use client";

import { useCallback, useEffect, useState } from "react";
import type { AIProvider } from "@/lib/providers";
import type { ProviderModel } from "@/lib/types";
import { useSettingsStore } from "@/stores/settings-store";
import { getModels } from "@/lib/ai-client";
import { getProviderKey, isApiKeyProvider } from "@/lib/ai/provider-runtime";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";

// Module-level cache shared across every consumer of this hook, so switching
// between the model dropdown and the Codex model manager doesn't re-fetch.
const modelCache: Record<string, ProviderModel[]> = {};
// Credential snapshot per provider — a change invalidates that provider's cache.
const credentialSnapshot: Record<string, string> = {};

/**
 * A stable cache key for a provider's credentials. For Codex we key on
 * *presence* (connected vs not), NOT the exact access token: the token manager
 * rotates the access token proactively, and keying on its value would blow the
 * cache away on every rotation and re-fetch — one of which can transiently come
 * back empty and then stick. API-key providers key on the actual key (a
 * different key genuinely means a different model list).
 */
function credKey(provider: AIProvider, credentials: ReturnType<typeof useSettingsStore.getState>["settings"]["providerCredentials"]): string {
  if (provider === "codex") return credentials.codexAccessToken ? "connected" : "";
  if (isApiKeyProvider(provider)) return getProviderKey(provider, credentials);
  return "";
}

export interface ProviderModelsState {
  models: ProviderModel[];
  loading: boolean;
  /** Non-null when the fetch failed (as opposed to genuinely having no models). */
  error: string | null;
  /** Force a fresh fetch, bypassing the cache. */
  reload: () => void;
}

/**
 * Fetch the model list for a provider, with credential-aware caching and
 * Codex token refresh. The single source of truth for "what models does this
 * provider offer right now" across settings UI.
 */
export function useProviderModels(provider: AIProvider): ProviderModelsState {
  const [models, setModels] = useState<ProviderModel[]>(modelCache[provider] ?? []);
  const [loading, setLoading] = useState(!modelCache[provider]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const credentials = useSettingsStore((s) => s.settings.providerCredentials);
  const updateProviderCredentials = useSettingsStore((s) => s.updateProviderCredentials);

  const reload = useCallback(() => {
    delete modelCache[provider];
    setNonce((n) => n + 1);
  }, [provider]);

  useEffect(() => {
    let cancelled = false;

    // One fetch attempt. Returns the parsed models, or throws with a message.
    async function fetchOnce(): Promise<ProviderModel[]> {
      const headers: Record<string, string> = {};
      if (provider === "codex") {
        const authToken = await ensureValidCodexToken(
          credentials.codexAccessToken,
          credentials.codexRefreshToken,
          updateProviderCredentials,
        );
        // Session is definitively dead — signal "not signed in", not an error.
        if (!authToken) return [];
        headers["x-auth-token"] = authToken;
      } else if (isApiKeyProvider(provider)) {
        const key = getProviderKey(provider, credentials);
        if (key) headers["x-api-key"] = key;
      }

      let response = await getModels(provider, headers);
      if (response.status === 401 && provider === "codex") {
        const fresh = await forceRefreshCodexToken(updateProviderCredentials);
        if (fresh) response = await getModels(provider, { "x-auth-token": fresh });
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
      }
      return data.models ?? [];
    }

    async function load() {
      // A key-based provider with no key has no catalogue to show. Asking
      // anyway is how the picker used to fill with OpenRouter's public list
      // for someone who had never connected OpenRouter.
      if (isApiKeyProvider(provider) && !getProviderKey(provider, credentials).trim()) {
        delete modelCache[provider];
        credentialSnapshot[provider] = "";
        setModels([]);
        setLoading(false);
        setError(null);
        return;
      }

      const key = credKey(provider, credentials);
      if (credentialSnapshot[provider] !== undefined && credentialSnapshot[provider] !== key) {
        delete modelCache[provider];
      }
      credentialSnapshot[provider] = key;

      if (modelCache[provider]) {
        setModels(modelCache[provider]);
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        let fetched = await fetchOnce();

        // A signed-in Codex account should always return models; an empty list
        // is almost always a token-not-ready race. Retry once before believing
        // it, and never cache an empty result so it can't stick.
        if (fetched.length === 0 && provider === "codex" && credentials.codexAccessToken) {
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;
          fetched = await fetchOnce();
        }

        if (cancelled) return;
        if (fetched.length > 0) modelCache[provider] = fetched;
        setModels(fetched);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load models");
        setModels([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [provider, credentials, updateProviderCredentials, nonce]);

  return { models, loading, error, reload };
}
