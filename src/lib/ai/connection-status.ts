/**
 * Single source of truth for "is there a working AI provider for this
 * feature." Pure — no React, no side effects — so it's unit-testable and
 * safe to call from hooks, components, and the onboarding flow alike.
 *
 * Replaces the ad-hoc "configured" checks that used to live separately in
 * onboarding-flow.tsx, provider-settings.tsx, and each feature hook.
 */

import type { AppSettings, AIProvider } from "@/lib/types";
import { PROVIDER_IDS, getProviderKey } from "@/lib/ai/provider-runtime";
import { isHosted } from "@/lib/edition";

export type FeatureKey = "snippetLabeling" | "slashCommand" | "inlineEdit";

export interface ResolvedAuth {
  provider: AIProvider;
  model: string;
  /** API key for key-based providers (empty string if none / N/A). */
  apiKey: string;
  /** True when a credential/token is present for this provider. */
  present: boolean;
}

/** True when a credential/token exists for this provider (says nothing about validity). */
function isProviderPresent(provider: AIProvider, settings: AppSettings): boolean {
  if (provider === "codex") return settings.providerCredentials.codexAccessToken.length > 0;
  // Can't cheaply prove the Ollama daemon is up — presence is assumed; a real
  // failure during use is caught reactively (see hooks' 401/unreachable handling).
  if (provider === "ollama") return true;
  return getProviderKey(provider, settings.providerCredentials).length > 0;
}

/** Resolve which provider a feature uses and whether a credential is present. */
export function resolveFeatureAuth(feature: FeatureKey, settings: AppSettings): ResolvedAuth {
  const { provider, model } = settings.featureProviders[feature];
  return {
    provider,
    model,
    apiKey: getProviderKey(provider, settings.providerCredentials),
    present: isProviderPresent(provider, settings),
  };
}

/**
 * True when the feature's active provider is usable:
 *   - hosted edition → always true (managed AI), OR
 *   - a present provider (see `isProviderPresent`) that hasn't been marked
 *     bad this session (a live 401 / Codex `invalid_grant`).
 *
 * `badProviders` is passed in (from app-store) to keep this module pure.
 */
export function hasWorkingProvider(
  settings: AppSettings,
  badProviders: ReadonlySet<AIProvider>,
  feature: FeatureKey,
): boolean {
  if (isHosted()) return true;
  const auth = resolveFeatureAuth(feature, settings);
  return auth.present && !badProviders.has(auth.provider);
}

/**
 * True when ANY provider is present (used by onboarding auto-skip & Settings'
 * "connect a provider" banner).
 *
 * Deliberately excludes Ollama's blanket "always present" from counting here:
 * that rule exists so a feature already pointed at Ollama isn't blocked by a
 * gate we can't validate cheaply, but it must NOT make this function always
 * true — otherwise onboarding's Connect step and Settings' banner would never
 * show, even with zero credentials configured. Ollama only counts once a
 * feature has actually been set to it (mirrors the pre-gate `isAiConfigured`
 * check it replaces).
 */
export function hasAnyProviderPresent(settings: AppSettings): boolean {
  const hasCredential = PROVIDER_IDS.some((id) => id !== "ollama" && isProviderPresent(id, settings));
  if (hasCredential) return true;
  return Object.values(settings.featureProviders).some((fp) => fp.provider === "ollama");
}
