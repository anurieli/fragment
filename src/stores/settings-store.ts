"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage } from "zustand/middleware";
import type {
  AppSettings,
  ProviderCredentials,
  FeatureProviderConfig,
  UserProfile,
  WritingStyleSettings,
  BrandVoiceSettings,
  ImageGenerationSettings,
  SnippetLabelingSettings,
  SlashCommandSettings,
  InlineEditSettings,
} from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { getProvider } from "@/lib/providers";
import { db } from "@/lib/db";
import { isTauri } from "@/lib/ai-client";
import {
  loadSecureCredentials,
  saveSecureCredentials,
  stripCredentials,
} from "@/lib/secure-credentials";

type FeatureKey = keyof AppSettings["featureProviders"];

// ---------------------------------------------------------------------------
// Dedicated credential backup — independent of settings persistence.
// Belt-and-suspenders: even if the settings write path fails, loses data
// during serialization, or strips credentials incorrectly, this backup
// ensures credentials can be recovered on next load.
// ---------------------------------------------------------------------------

const CREDENTIAL_BACKUP_KEY = "fragment:credentials";

function backupCredentials(creds: ProviderCredentials): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CREDENTIAL_BACKUP_KEY, JSON.stringify(creds));
  } catch {
    // localStorage full or unavailable — silent
  }
}

function loadCredentialBackup(): ProviderCredentials | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CREDENTIAL_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.openRouterApiKey === "string"
    ) {
      return parsed as unknown as ProviderCredentials;
    }
    return null;
  } catch {
    return null;
  }
}

function hasAnyCredential(creds: ProviderCredentials): boolean {
  return Object.values(creds).some((v) => typeof v === "string" && v.length > 0);
}

interface SettingsState {
  settings: AppSettings;

  setSettings: (s: AppSettings) => void;
  updateProviderCredentials: (partial: Partial<ProviderCredentials>) => void;
  setCodexEnabledModels: (modelIds: string[]) => void;
  updateFeatureProvider: (
    feature: FeatureKey,
    config: Partial<FeatureProviderConfig>,
  ) => void;
  updateUserProfile: (partial: Partial<UserProfile>) => void;
  updateWritingStyle: (partial: Partial<WritingStyleSettings>) => void;
  updateBrandVoiceSettings: (partial: Partial<BrandVoiceSettings>) => void;
  resetVoiceAnalysisPrompt: () => void;
  updateImageGeneration: (partial: Partial<ImageGenerationSettings>) => void;
  updateSnippetLabeling: (partial: Partial<SnippetLabelingSettings>) => void;
  updateSlashCommand: (partial: Partial<SlashCommandSettings>) => void;
  updateInlineEdit: (partial: Partial<InlineEditSettings>) => void;
  resetSnippetLabelingPrompt: () => void;
  resetSlashCommandPrompt: () => void;
  resetInlineEditPrompt: () => void;
}

type PersistedSettingsState = Pick<SettingsState, "settings">;
const SETTINGS_SHADOW_KEY = "fragment:settings:shadow";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- stored state may have pre-migration shape
function mergePersistedSettings(persisted: unknown): AppSettings {
  const raw = (persisted && typeof persisted === "object" ? persisted : {}) as any;
  const { __savedAt: _ignoredSavedAt, ...s } = raw;
  const snippetPersisted = s.featureProviders?.snippetLabeling ?? {};
  const slashPersisted = s.featureProviders?.slashCommand ?? {};
  const inlineEditPersisted = s.featureProviders?.inlineEdit ?? {};
  const snippetDefaults = DEFAULT_SETTINGS.featureProviders.snippetLabeling;
  const slashDefaults = DEFAULT_SETTINGS.featureProviders.slashCommand;
  const inlineEditDefaults = DEFAULT_SETTINGS.featureProviders.inlineEdit;
  const mergedSnippet = {
    ...snippetDefaults,
    ...snippetPersisted,
    modelsByProvider: {
      ...(snippetDefaults.modelsByProvider ?? {}),
      ...(snippetPersisted.modelsByProvider ?? {}),
    },
  };
  const mergedSlash = {
    ...slashDefaults,
    ...slashPersisted,
    modelsByProvider: {
      ...(slashDefaults.modelsByProvider ?? {}),
      ...(slashPersisted.modelsByProvider ?? {}),
    },
  };
  const mergedInlineEdit = {
    ...inlineEditDefaults,
    ...inlineEditPersisted,
    modelsByProvider: {
      ...(inlineEditDefaults.modelsByProvider ?? {}),
      ...(inlineEditPersisted.modelsByProvider ?? {}),
    },
  };
  // Fix known-invalid model IDs that were persisted from bad defaults
  const INVALID_MODELS: Record<string, string> = { "google/gemini-3.0-flash": "google/gemini-2.0-flash-001" };
  for (const fp of [mergedSnippet, mergedSlash, mergedInlineEdit]) {
    if (INVALID_MODELS[fp.model]) fp.model = INVALID_MODELS[fp.model];
    if (fp.modelsByProvider) {
      for (const p of Object.keys(fp.modelsByProvider)) {
        if (INVALID_MODELS[fp.modelsByProvider[p]]) fp.modelsByProvider[p] = INVALID_MODELS[fp.modelsByProvider[p]];
      }
    }
  }

  mergedSnippet.modelsByProvider[mergedSnippet.provider] = mergedSnippet.model;
  mergedSlash.modelsByProvider[mergedSlash.provider] = mergedSlash.model;
  mergedInlineEdit.modelsByProvider[mergedInlineEdit.provider] = mergedInlineEdit.model;

  return {
    ...DEFAULT_SETTINGS,
    ...s,
    providerCredentials: {
      ...DEFAULT_SETTINGS.providerCredentials,
      ...s.providerCredentials,
    },
    featureProviders: {
      snippetLabeling: mergedSnippet,
      slashCommand: mergedSlash,
      inlineEdit: mergedInlineEdit,
    },
    userProfile: { ...DEFAULT_SETTINGS.userProfile, ...s.userProfile },
    writingStyle: { ...DEFAULT_SETTINGS.writingStyle, ...s.writingStyle },
    brandVoice: { ...DEFAULT_SETTINGS.brandVoice, ...s.brandVoice },
    imageGeneration: { ...DEFAULT_SETTINGS.imageGeneration, ...s.imageGeneration },
    snippetLabeling: { ...DEFAULT_SETTINGS.snippetLabeling, ...s.snippetLabeling },
    slashCommand: { ...DEFAULT_SETTINGS.slashCommand, ...s.slashCommand },
    inlineEdit: { ...DEFAULT_SETTINGS.inlineEdit, ...s.inlineEdit },
  };
}

function toStorable(settings: AppSettings, savedAt: number): AppSettings & { __savedAt: number } {
  return { ...settings, id: settings.id || "default", __savedAt: savedAt };
}

// Zustand persist expects `{ state, version }`.
// Older app builds may have stored plain settings objects at this key.
function normalizePersistRoot(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const root = value as Record<string, unknown>;

  if ("state" in root) {
    return {
      state: root.state,
      version: typeof root.version === "number" ? root.version : 0,
    };
  }

  if ("settings" in root) {
    return { state: root, version: 0 };
  }

  if ("id" in root || "featureProviders" in root || "providerCredentials" in root) {
    return { state: { settings: root }, version: 0 };
  }

  return value;
}

function extractPersistedSettings(persistedState: unknown): unknown {
  const root = persistedState as Record<string, unknown> | null | undefined;
  const nested = root && "settings" in root ? root.settings : undefined;
  return nested ?? persistedState;
}

function parseStoredSettings(value: unknown): AppSettings {
  const normalized = normalizePersistRoot(value) as { state?: unknown } | null;
  const persisted = extractPersistedSettings(normalized?.state);
  return mergePersistedSettings(persisted);
}

function parseLocalSnapshot(
  raw: string | null,
): { settings: AppSettings; savedAt: number; hasSavedAt: boolean } | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const hasSavedAt = typeof parsed.savedAt === "number";
    const savedAt = hasSavedAt ? (parsed.savedAt as number) : 0;
    const settingsSource =
      parsed && typeof parsed === "object" && "settings" in parsed
        ? parsed.settings
        : parsed;
    return {
      settings: parseStoredSettings(settingsSource),
      savedAt,
      hasSavedAt,
    };
  } catch {
    return null;
  }
}

function readLocalSnapshot(name: string): { settings: AppSettings; savedAt: number } | null {
  if (typeof window === "undefined") return null;

  const shadow = parseLocalSnapshot(window.localStorage.getItem(SETTINGS_SHADOW_KEY));
  const legacy = parseLocalSnapshot(window.localStorage.getItem(name));

  // Prefer explicit legacy payloads that do not include our snapshot metadata.
  // This preserves migration behavior when only the old key is written.
  if (legacy && !legacy.hasSavedAt) {
    return { settings: legacy.settings, savedAt: legacy.savedAt };
  }

  if (shadow && legacy) {
    return shadow.savedAt >= legacy.savedAt
      ? { settings: shadow.settings, savedAt: shadow.savedAt }
      : { settings: legacy.settings, savedAt: legacy.savedAt };
  }

  if (shadow) return { settings: shadow.settings, savedAt: shadow.savedAt };
  if (legacy) return { settings: legacy.settings, savedAt: legacy.savedAt };
  return null;
}

function writeLocalSnapshot(name: string, settings: AppSettings, savedAt: number): void {
  if (typeof window === "undefined") return;
  const payload = JSON.stringify({ savedAt, settings });
  window.localStorage.setItem(SETTINGS_SHADOW_KEY, payload);
  // Keep legacy key in sync for older builds and migration safety.
  window.localStorage.setItem(name, payload);
}

// Hydration guard: prevents setItem from overwriting saved data with defaults
// before getItem has finished loading persisted settings.
let hydrationComplete = false;

const settingsStorage: PersistStorage<PersistedSettingsState> = {
  getItem: async (name) => {
    // Try IndexedDB first, fall back to localStorage on error
    let fromDb: (AppSettings & { __savedAt?: number }) | undefined;
    try {
      fromDb = await db.settings.get("default") as (AppSettings & { __savedAt?: number }) | undefined;
    } catch {
      // IndexedDB may be unavailable (e.g. during Dexie upgrade or private browsing)
      fromDb = undefined;
    }
    const dbSavedAt = typeof fromDb?.__savedAt === "number" ? fromDb.__savedAt : 0;
    const localSnapshot = readLocalSnapshot(name);

    let settings: AppSettings;
    if (localSnapshot && localSnapshot.savedAt >= dbSavedAt) {
      try { await db.settings.put(toStorable(localSnapshot.settings, localSnapshot.savedAt)); } catch { /* best-effort sync */ }
      settings = localSnapshot.settings;
    } else if (fromDb) {
      settings = mergePersistedSettings(fromDb);
      writeLocalSnapshot(name, settings, dbSavedAt || Date.now());
    } else if (localSnapshot) {
      try { await db.settings.put(toStorable(localSnapshot.settings, localSnapshot.savedAt || Date.now())); } catch { /* best-effort sync */ }
      settings = localSnapshot.settings;
    } else {
      hydrationComplete = true;
      return null;
    }

    // In Tauri: load credentials from encrypted Stronghold vault.
    // If Stronghold has credentials, use those. Otherwise migrate any
    // credentials found in IndexedDB → Stronghold (one-time migration).
    if (isTauri()) {
      const secure = await loadSecureCredentials();
      if (secure) {
        const hasSecure = hasAnyCredential(secure);
        const hasInsecure = hasAnyCredential(settings.providerCredentials);

        if (hasSecure) {
          // Stronghold is authoritative
          settings = { ...settings, providerCredentials: secure };
        } else if (hasInsecure) {
          // One-time migration: move credentials from IndexedDB → Stronghold
          await saveSecureCredentials(settings.providerCredentials);
          // Clear credentials from IndexedDB
          const stripped = stripCredentials(settings);
          const savedAt = Date.now();
          writeLocalSnapshot(name, stripped, savedAt);
          await db.settings.put(toStorable(stripped, savedAt));
        }
      }
    }

    // Safety net: if credentials are still empty after all loading paths
    // (IndexedDB, localStorage, Stronghold), restore from the dedicated
    // credential backup. This catches scenarios where credentials were
    // lost due to serialization bugs, failed writes, or strip/restore
    // mismatches.
    if (!hasAnyCredential(settings.providerCredentials)) {
      const backup = loadCredentialBackup();
      if (backup && hasAnyCredential(backup)) {
        settings = {
          ...settings,
          providerCredentials: { ...settings.providerCredentials, ...backup },
        };
      }
    }

    // Sync the credential backup with whatever we loaded (keeps it fresh)
    if (hasAnyCredential(settings.providerCredentials)) {
      backupCredentials(settings.providerCredentials);
    }

    hydrationComplete = true;
    return { state: { settings }, version: 0 };
  },
  setItem: async (name, value) => {
    // Block writes until hydration completes to prevent defaults from
    // overwriting real settings during the async getItem window.
    if (!hydrationComplete) return;

    const state = value.state as PersistedSettingsState | undefined;
    const settings = parseStoredSettings(state?.settings ?? DEFAULT_SETTINGS);
    const savedAt = Date.now();

    // Always maintain a dedicated credential backup, independent of the
    // settings persistence path. This is the last line of defense against
    // credential loss from serialization bugs or storage failures.
    backupCredentials(settings.providerCredentials);

    // In Tauri: persist credentials to Stronghold, strip from IndexedDB.
    // Only strip if Stronghold confirmed the save — never discard
    // credentials from the persisted copy unless they're safely stored
    // elsewhere.
    if (isTauri()) {
      const saved = await saveSecureCredentials(settings.providerCredentials);
      const toStore = saved ? stripCredentials(settings) : settings;
      writeLocalSnapshot(name, toStore, savedAt);
      try { await db.settings.put(toStorable(toStore, savedAt)); } catch { /* localStorage is the fallback */ }
    } else {
      writeLocalSnapshot(name, settings, savedAt);
      try { await db.settings.put(toStorable(settings, savedAt)); } catch { /* localStorage is the fallback */ }
    }
  },
  removeItem: async (name) => {
    try { await db.settings.delete("default"); } catch { /* best-effort */ }
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(name);
      window.localStorage.removeItem(SETTINGS_SHADOW_KEY);
    }
  },
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,

      setSettings: (s) => set({ settings: s }),

      updateProviderCredentials: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            providerCredentials: { ...current.providerCredentials, ...partial },
          },
        });
      },

      updateFeatureProvider: (feature, config) => {
        const current = get().settings;
        const currentFeature = current.featureProviders[feature];
        const nextProvider = config.provider ?? currentFeature.provider;
        const nextModelsByProvider = {
          ...(currentFeature.modelsByProvider ?? {}),
        };

        if (config.model) {
          nextModelsByProvider[nextProvider] = config.model;
        }

        let nextModel = config.model ?? currentFeature.model;
        if (config.provider && !config.model) {
          nextModel =
            nextModelsByProvider[nextProvider] ??
            getProvider(nextProvider).defaultModel;
        }

        if (!nextModelsByProvider[nextProvider]) {
          nextModelsByProvider[nextProvider] = nextModel;
        }

        set({
          settings: {
            ...current,
            featureProviders: {
              ...current.featureProviders,
              [feature]: {
                ...currentFeature,
                ...config,
                provider: nextProvider,
                model: nextModel,
                modelsByProvider: nextModelsByProvider,
              },
            },
          },
        });
      },

      setCodexEnabledModels: (modelIds) => {
        const current = get().settings;
        set({
          settings: { ...current, codexEnabledModels: modelIds },
        });
      },

      updateUserProfile: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            userProfile: { ...current.userProfile, ...partial },
          },
        });
      },

      updateWritingStyle: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            writingStyle: { ...current.writingStyle, ...partial },
          },
        });
      },

      updateBrandVoiceSettings: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            brandVoice: { ...current.brandVoice, ...partial },
          },
        });
      },

      resetVoiceAnalysisPrompt: () => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            brandVoice: {
              ...current.brandVoice,
              analysisPromptTemplate: DEFAULT_SETTINGS.brandVoice.analysisPromptTemplate,
            },
          },
        });
      },

      updateImageGeneration: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            imageGeneration: { ...current.imageGeneration, ...partial },
          },
        });
      },

      updateSnippetLabeling: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            snippetLabeling: { ...current.snippetLabeling, ...partial },
          },
        });
      },

      updateSlashCommand: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            slashCommand: { ...current.slashCommand, ...partial },
          },
        });
      },

      updateInlineEdit: (partial) => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            inlineEdit: { ...current.inlineEdit, ...partial },
          },
        });
      },

      resetSnippetLabelingPrompt: () => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            snippetLabeling: {
              ...current.snippetLabeling,
              promptTemplate: DEFAULT_SETTINGS.snippetLabeling.promptTemplate,
            },
          },
        });
      },

      resetSlashCommandPrompt: () => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            slashCommand: {
              ...current.slashCommand,
              promptTemplate: DEFAULT_SETTINGS.slashCommand.promptTemplate,
            },
          },
        });
      },

      resetInlineEditPrompt: () => {
        const current = get().settings;
        set({
          settings: {
            ...current,
            inlineEdit: {
              ...current.inlineEdit,
              promptTemplate: DEFAULT_SETTINGS.inlineEdit.promptTemplate,
            },
          },
        });
      },
    }),
    {
      name: "fragment:settings",
      storage: settingsStorage,
      partialize: (state) => ({ settings: state.settings }),
      merge: (persistedState, currentState) => {
        const ps = persistedState as PersistedSettingsState | undefined;
        if (ps?.settings) {
          return { ...currentState, settings: ps.settings };
        }
        return currentState;
      },
    },
  ),
);

/** Wait for the settings store to finish loading from IndexedDB / Stronghold. */
export async function waitForSettingsHydration(): Promise<void> {
  const persist = (useSettingsStore as unknown as {
    persist: {
      hasHydrated: () => boolean;
      onFinishHydration: (fn: () => void) => () => void;
    };
  }).persist;
  if (persist.hasHydrated()) return;
  return new Promise<void>((resolve) => {
    const unsub = persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
    if (persist.hasHydrated()) {
      unsub();
      resolve();
    }
  });
}
