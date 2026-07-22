"use client";

import { useCallback, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { useCodexSignIn } from "@/hooks/use-codex-signin";
import { validateProviderCredential } from "@/lib/ai-client";
import { getProviderKeyField } from "@/lib/ai/provider-runtime";
import type { AIProvider } from "@/lib/types";
import type { FeatureKey } from "@/lib/ai/connection-status";

export type ConnectState = "idle" | "validating" | "success" | "error";

const ALL_FEATURES: FeatureKey[] = ["snippetLabeling", "slashCommand", "inlineEdit"];

export interface UseProviderConnect {
  state: ConnectState;
  error: string | null;
  /** True when the last failure looks like a reach problem (not a rejected key) — safe to bypass. */
  canSaveAnyway: boolean;
  /** Save + validate a key provider. On success: persist key, set it as the
   *  active provider for `activateFor` (default: all three features), clear it
   *  from badProviders, and fire onConnected. */
  connectKeyProvider: (provider: AIProvider, apiKey: string) => Promise<void>;
  /** Codex device-flow (delegates to useCodexSignIn). */
  codex: ReturnType<typeof useCodexSignIn>;
  /** Ollama: validate the local daemon, then activate. */
  connectOllama: () => Promise<void>;
  /** Escape hatch for a reach failure (network/5xx) — activates without a confirmed validation. */
  saveAnyway: (provider: AIProvider) => void;
  reset: () => void;
}

export function useProviderConnect(opts?: {
  activateFor?: FeatureKey[];
  onConnected?: (provider: AIProvider) => void;
}): UseProviderConnect {
  const activateFor = opts?.activateFor ?? ALL_FEATURES;
  const onConnected = opts?.onConnected;

  const updateProviderCredentials = useSettingsStore((s) => s.updateProviderCredentials);
  const updateFeatureProvider = useSettingsStore((s) => s.updateFeatureProvider);
  const clearProviderBad = useAppStore((s) => s.clearProviderBad);

  const [state, setState] = useState<ConnectState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [canSaveAnyway, setCanSaveAnyway] = useState(false);

  /** Point every `activateFor` feature at this provider and clear its bad flag. */
  const activate = useCallback(
    (provider: AIProvider) => {
      for (const feature of activateFor) {
        updateFeatureProvider(feature, { provider });
      }
      clearProviderBad(provider);
    },
    [activateFor, updateFeatureProvider, clearProviderBad],
  );

  const connectKeyProvider = useCallback(
    async (provider: AIProvider, apiKey: string) => {
      const trimmed = apiKey.trim();
      setState("validating");
      setError(null);
      setCanSaveAnyway(false);

      // Persist first so the key survives even if the user closes mid-flow.
      const field = getProviderKeyField(provider);
      if (field) updateProviderCredentials({ [field]: trimmed });

      const result = await validateProviderCredential({ provider, apiKey: trimmed });
      if (result.ok) {
        activate(provider);
        setState("success");
        onConnected?.(provider);
        return;
      }

      setState("error");
      setError(result.error || "Couldn't validate that key.");
      setCanSaveAnyway(Boolean(result.unreachable));
    },
    [activate, onConnected, updateProviderCredentials],
  );

  const connectOllama = useCallback(async () => {
    setState("validating");
    setError(null);
    setCanSaveAnyway(false);

    const result = await validateProviderCredential({ provider: "ollama" });
    if (result.ok) {
      activate("ollama");
      setState("success");
      onConnected?.("ollama");
      return;
    }

    setState("error");
    setError("Ollama isn't reachable — is it running?");
    setCanSaveAnyway(true); // they may start it later; never trap the user
  }, [activate, onConnected]);

  const saveAnyway = useCallback(
    (provider: AIProvider) => {
      activate(provider);
      setState("success");
      onConnected?.(provider);
    },
    [activate, onConnected],
  );

  const codex = useCodexSignIn(() => {
    // useCodexSignIn already stores tokens and sets codexConnection = "connected";
    // this only needs to point activateFor features at codex and clear its bad flag.
    activate("codex");
    onConnected?.("codex");
  });

  const reset = useCallback(() => {
    setState("idle");
    setError(null);
    setCanSaveAnyway(false);
  }, []);

  return { state, error, canSaveAnyway, connectKeyProvider, codex, connectOllama, saveAnyway, reset };
}
