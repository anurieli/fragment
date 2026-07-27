/**
 * The Generate Title button (ARI-45) is only worth having if the title it
 * writes comes from the whole note: the draft AND the context fields the user
 * filled in (goal, audience, tone, remember). These drive the real hook
 * against a mocked ai-client, so the request body is checked as it is actually
 * sent, and pin the two ways the button must decline rather than damage a
 * title the user typed: no provider connected, and a failed request.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const postGenerate = vi.fn();

vi.mock("@/lib/ai-client", () => ({
  postGenerate: (...args: unknown[]) => postGenerate(...args),
  isTauri: () => false,
}));

vi.mock("@/lib/persistence", () => ({
  saveNote: vi.fn().mockResolvedValue(undefined),
  deleteNoteAndSnippets: vi.fn(),
  saveSnippet: vi.fn(),
  deleteSnippet: vi.fn(),
  saveVersion: vi.fn(),
  deleteVersion: vi.fn(),
}));

vi.mock("@/lib/api-logger", () => ({ logApiCall: vi.fn().mockResolvedValue(undefined) }));

import { useGenerateTitle } from "@/hooks/use-generate-title";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { DEFAULT_SETTINGS, DEFAULT_TITLE_PROMPT } from "@/lib/defaults";

const DRAFT = "Most engineering teams keep two roadmaps: the one on the wall, and the one they work from.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A note with every context field filled, so the prompt has metadata to carry. */
function seedNote(): string {
  const store = useDataStore.getState();
  const id = store.createNote();
  store.updateNoteTitle(id, "Untitled draft");
  store.updateNoteContent(id, DRAFT);
  store.updateNoteGoal(id, "Convince skeptical CTOs to cut their roadmap");
  store.updateNoteAudience(id, "Engineering leaders at 50-person startups");
  store.updateNoteTone(id, "Direct, no hedging");
  store.updateNoteRemember(id, "Never name a specific vendor");
  return id;
}

function connectProvider(): void {
  useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
  useSettingsStore.getState().updateProviderCredentials({ openRouterApiKey: "sk-test-key" });
}

async function runGenerate(noteId: string, content: string): Promise<void> {
  const { result } = renderHook(() => useGenerateTitle());
  await act(async () => {
    await result.current.generateTitle(noteId, content);
  });
}

describe("useGenerateTitle", () => {
  beforeEach(() => {
    postGenerate.mockReset();
    useDataStore.setState({ notes: {}, snippets: {}, versions: {}, hydrated: true });
    useAppStore.setState({ aiGate: null, badProviders: new Set() });
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
  });

  it("sends the draft and every context field, then applies the cleaned title", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ content: '**"Two Roadmaps"**' }));

    const id = seedNote();
    await runGenerate(id, DRAFT);

    expect(postGenerate).toHaveBeenCalledTimes(1);
    const body = JSON.parse(postGenerate.mock.calls[0][0] as string);
    expect(body.promptTemplate).toBe(DEFAULT_TITLE_PROMPT);
    expect(body.contextAbove).toContain("two roadmaps");
    expect(body.goal).toBe("Convince skeptical CTOs to cut their roadmap");
    expect(body.audience).toBe("Engineering leaders at 50-person startups");
    expect(body.tone).toBe("Direct, no hedging");
    expect(body.remember).toBe("Never name a specific vendor");

    expect(useDataStore.getState().notes[id].title).toBe("Two Roadmaps");
  });

  it("falls back to the saved note content when the editor passes nothing", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ content: "Two Roadmaps" }));

    const id = seedNote();
    await runGenerate(id, "");

    const body = JSON.parse(postGenerate.mock.calls[0][0] as string);
    expect(body.contextAbove).toBe(DRAFT);
  });

  it("opens the connection gate instead of calling out when no provider is connected", async () => {
    postGenerate.mockResolvedValue(jsonResponse({ content: "Two Roadmaps" }));

    const id = seedNote();
    await runGenerate(id, DRAFT);

    expect(postGenerate).not.toHaveBeenCalled();
    expect(useAppStore.getState().aiGate).toEqual({ reason: "no-provider", provider: undefined });
    expect(useDataStore.getState().notes[id].title).toBe("Untitled draft");
  });

  it("leaves the existing title alone when the request fails", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ error: "Generation failed" }, 500));

    const id = seedNote();
    await runGenerate(id, DRAFT);

    expect(useDataStore.getState().notes[id].title).toBe("Untitled draft");
  });

  it("leaves the existing title alone when the model returns nothing usable", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ content: "   " }));

    const id = seedNote();
    await runGenerate(id, DRAFT);

    expect(useDataStore.getState().notes[id].title).toBe("Untitled draft");
  });

  it("never calls out for an empty note", async () => {
    connectProvider();
    const id = useDataStore.getState().createNote();

    await runGenerate(id, "");

    expect(postGenerate).not.toHaveBeenCalled();
  });
});
