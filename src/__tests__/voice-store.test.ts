import { describe, it, expect, beforeEach } from "vitest";
import { useVoiceStore, computeWritingStyleSeed, MAX_VOICES } from "@/stores/voice-store";
import { useSettingsStore } from "@/stores/settings-store";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { db } from "@/lib/db";

async function reset() {
  localStorage.clear();
  await db.settings.clear();
  await db.voices.clear();
  await db.voiceSamples.clear();
  useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
  useVoiceStore.setState({ voices: {}, hydrated: true });
}

describe("computeWritingStyleSeed", () => {
  it("seeds a default voice from a non-empty description on first run", () => {
    const seed = computeWritingStyleSeed({
      migrated: false,
      voiceDescription: "Punchy and direct.",
      existingCount: 0,
      now: 123,
    });
    expect(seed).not.toBeNull();
    expect(seed!.id).toBe("voice-default");
    expect(seed!.name).toBe("My voice");
    expect(seed!.description).toBe("Punchy and direct.");
    expect(seed!.profileStale).toBe(true);
  });

  it("is idempotent — already migrated yields no seed", () => {
    expect(
      computeWritingStyleSeed({ migrated: true, voiceDescription: "x", existingCount: 0, now: 1 }),
    ).toBeNull();
  });

  it("no seed when description is empty", () => {
    expect(
      computeWritingStyleSeed({ migrated: false, voiceDescription: "   ", existingCount: 0, now: 1 }),
    ).toBeNull();
  });

  it("no seed when voices already exist", () => {
    expect(
      computeWritingStyleSeed({ migrated: false, voiceDescription: "x", existingCount: 2, now: 1 }),
    ).toBeNull();
  });
});

describe("voice-store actions", () => {
  beforeEach(async () => {
    await reset();
  });

  it("addBrandVoice creates a voice and sets it as the first default", () => {
    const id = useVoiceStore.getState().addBrandVoice({ name: "Alpha" });
    expect(id).not.toBeNull();
    expect(useVoiceStore.getState().voices[id!].name).toBe("Alpha");
    expect(useSettingsStore.getState().settings.brandVoice.defaultVoiceId).toBe(id);
  });

  it("caps at MAX_VOICES", () => {
    for (let i = 0; i < MAX_VOICES; i++) {
      expect(useVoiceStore.getState().addBrandVoice({ name: `v${i}` })).not.toBeNull();
    }
    expect(useVoiceStore.getState().addBrandVoice({ name: "overflow" })).toBeNull();
    expect(Object.keys(useVoiceStore.getState().voices).length).toBe(MAX_VOICES);
  });

  it("updateBrandVoice merges partial and bumps updatedAt", () => {
    const id = useVoiceStore.getState().addBrandVoice({ name: "A" })!;
    const before = useVoiceStore.getState().voices[id].updatedAt;
    useVoiceStore.getState().updateBrandVoice(id, { description: "new desc", profileStale: true });
    const after = useVoiceStore.getState().voices[id];
    expect(after.description).toBe("new desc");
    expect(after.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("deleteBrandVoice promotes the first remaining voice to default", () => {
    const a = useVoiceStore.getState().addBrandVoice({ name: "A" })!;
    const b = useVoiceStore.getState().addBrandVoice({ name: "B" })!;
    // a is default (created first)
    expect(useSettingsStore.getState().settings.brandVoice.defaultVoiceId).toBe(a);
    useVoiceStore.getState().deleteBrandVoice(a);
    expect(useVoiceStore.getState().voices[a]).toBeUndefined();
    expect(useSettingsStore.getState().settings.brandVoice.defaultVoiceId).toBe(b);
  });

  it("deleting the last voice clears the default", () => {
    const a = useVoiceStore.getState().addBrandVoice({ name: "A" })!;
    useVoiceStore.getState().deleteBrandVoice(a);
    expect(useSettingsStore.getState().settings.brandVoice.defaultVoiceId).toBeNull();
  });

  it("setVoices merges rather than replacing, so a voice created before hydration survives", () => {
    // Simulate the onboarding race: a voice is created in-memory, then the async
    // hydration tail resolves and calls setVoices with the (empty) DB snapshot.
    const created = useVoiceStore.getState().addBrandVoice({ name: "Onboarding" })!;
    useVoiceStore.getState().setVoices([]); // stale DB read, no rows yet
    expect(useVoiceStore.getState().voices[created]).toBeDefined();
    expect(useVoiceStore.getState().voices[created].name).toBe("Onboarding");
  });

  it("setVoices loads DB rows and keeps the in-memory copy on id collision", () => {
    const created = useVoiceStore.getState().addBrandVoice({ name: "Memory" })!;
    const loaded = { ...useVoiceStore.getState().voices[created], name: "Disk" };
    const other = { ...loaded, id: "other", name: "Other" };
    useVoiceStore.getState().setVoices([loaded, other]);
    // Loaded row for a new id appears; the in-memory version wins the collision.
    expect(useVoiceStore.getState().voices.other?.name).toBe("Other");
    expect(useVoiceStore.getState().voices[created].name).toBe("Memory");
  });
});
