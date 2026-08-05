"use client";

import { create } from "zustand";
import type { BrandVoice } from "@/lib/types";
import { generateId } from "@/lib/utils";
import { useSettingsStore } from "@/stores/settings-store";
import {
  saveVoice,
  deleteVoiceRow,
  deleteSamplesForVoice,
} from "@/lib/persistence";

export const MAX_VOICES = 5;

interface VoiceState {
  voices: Record<string, BrandVoice>;
  hydrated: boolean;

  setHydrated: (v: boolean) => void;
  setVoices: (voices: BrandVoice[]) => void;
  replaceVoices: (voices: BrandVoice[]) => void;

  /** Create a new voice. Returns its id, or null if at the cap. */
  addBrandVoice: (opts?: { name?: string; description?: string }) => string | null;
  updateBrandVoice: (id: string, partial: Partial<BrandVoice>) => void;
  deleteBrandVoice: (id: string) => void;
  setDefaultVoice: (id: string | null) => void;
}

/**
 * Pure decision for the one-shot writingStyle → Brand Voice migration.
 * Returns the voice to seed (or null) given the current state. Kept pure and
 * exported so it can be unit-tested for idempotence.
 */
export function computeWritingStyleSeed(opts: {
  migrated: boolean;
  voiceDescription: string;
  existingCount: number;
  now: number;
}): BrandVoice | null {
  if (opts.migrated) return null;
  const description = opts.voiceDescription.trim();
  if (!description || opts.existingCount > 0) return null;
  return {
    id: "voice-default",
    name: "My voice",
    description,
    template: "",
    profile: null,
    profileStale: true,
    profileUpdatedAt: null,
    analyzedSampleCount: 0,
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

function newVoice(opts?: { name?: string; description?: string }): BrandVoice {
  const now = Date.now();
  return {
    id: generateId(),
    name: opts?.name?.trim() || "Untitled voice",
    description: opts?.description ?? "",
    template: "",
    profile: null,
    profileStale: true,
    profileUpdatedAt: null,
    analyzedSampleCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  voices: {},
  hydrated: false,

  setHydrated: (v) => set({ hydrated: v }),

  setVoices: (voices) => {
    const loaded: Record<string, BrandVoice> = {};
    for (const v of voices) loaded[v.id] = v;
    // Merge, not replace: a voice created in-memory before hydration's async
    // tail resolves (onboarding's VoiceSetupStep, or Settings "New voice")
    // must survive. On a normal reload the in-memory map is empty, so this is
    // equivalent to a plain replace.
    set((s) => ({ voices: { ...loaded, ...s.voices } }));
  },

  replaceVoices: (voices) => {
    const loaded: Record<string, BrandVoice> = {};
    for (const voice of voices) loaded[voice.id] = voice;
    set({ voices: loaded });
  },

  addBrandVoice: (opts) => {
    const voices = get().voices;
    if (Object.keys(voices).length >= MAX_VOICES) return null;
    const voice = newVoice(opts);
    set({ voices: { ...voices, [voice.id]: voice } });
    saveVoice(voice);
    // First voice becomes the default automatically.
    const settings = useSettingsStore.getState();
    if (!settings.settings.brandVoice.defaultVoiceId) {
      settings.updateBrandVoiceSettings({ defaultVoiceId: voice.id });
    }
    return voice.id;
  },

  updateBrandVoice: (id, partial) => {
    const voices = get().voices;
    const existing = voices[id];
    if (!existing) return;
    const updated: BrandVoice = { ...existing, ...partial, updatedAt: Date.now() };
    set({ voices: { ...voices, [id]: updated } });
    saveVoice(updated);
  },

  deleteBrandVoice: (id) => {
    const voices = { ...get().voices };
    if (!voices[id]) return;
    delete voices[id];
    set({ voices });
    deleteVoiceRow(id);
    deleteSamplesForVoice(id);

    // If the deleted voice was the default, promote the first remaining voice.
    const settings = useSettingsStore.getState();
    if (settings.settings.brandVoice.defaultVoiceId === id) {
      const remaining = Object.values(voices).sort((a, b) => a.createdAt - b.createdAt);
      settings.updateBrandVoiceSettings({ defaultVoiceId: remaining[0]?.id ?? null });
    }
  },

  setDefaultVoice: (id) => {
    useSettingsStore.getState().updateBrandVoiceSettings({ defaultVoiceId: id });
  },
}));
