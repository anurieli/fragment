"use client";

import { useMemo } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { resolveWorkingFeatureAuth, type FeatureKey } from "@/lib/ai/connection-status";
import type { AIProvider } from "@/lib/types";

export interface EffectiveFeatureProvider {
  provider: AIProvider;
  model: string;
  /**
   * True when the stored provider is not connected and this is the one that
   * would actually answer. The picker shows the resolved provider rather than
   * the stored one so the panel cannot claim a provider the user never linked.
   */
  isFallback: boolean;
}

/**
 * Which provider and model a feature really runs on right now: the stored
 * choice when its credential is present, otherwise the sole connected
 * provider that `resolveWorkingFeatureAuth` falls back to at call time.
 *
 * Every surface that shows a model picker uses this, so what the picker says
 * and what the request sends are the same thing.
 */
export function useFeatureProvider(feature: FeatureKey): EffectiveFeatureProvider {
  const settings = useSettingsStore((s) => s.settings);
  const badProviders = useAppStore((s) => s.badProviders);

  return useMemo(() => {
    const stored = settings.featureProviders[feature];
    const resolved = resolveWorkingFeatureAuth(settings, badProviders, feature);
    if (!resolved || resolved.provider === stored.provider) {
      return { provider: stored.provider, model: stored.model, isFallback: false };
    }
    return { provider: resolved.provider, model: resolved.model, isFallback: true };
  }, [settings, badProviders, feature]);
}
