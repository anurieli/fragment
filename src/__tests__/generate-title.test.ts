/**
 * The Generate Title button (ARI-45) is only worth having if the title it
 * writes comes from the whole fragment: the draft AND the context fields the
 * user filled in (goal, audience, tone, remember). These drive the real hook
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

// Mock the writes, keep the real guards, exactly as content-store.test.ts does.
vi.mock("@/lib/persistence", async () => {
  const actual = await vi.importActual<typeof import("@/lib/persistence")>(
    "@/lib/persistence",
  );
  return {
    ...actual,
    saveIdea: vi.fn().mockResolvedValue(undefined),
    savePiece: vi.fn().mockResolvedValue(undefined),
    saveSnippet: vi.fn(),
    deleteSnippet: vi.fn(),
    savePieceVersion: vi.fn(),
    deletePieceVersion: vi.fn(),
  };
});

vi.mock("@/lib/api-logger", () => ({ logApiCall: vi.fn().mockResolvedValue(undefined) }));

import { useGenerateTitle } from "@/hooks/use-generate-title";
import { useContentStore } from "@/stores/content-store";
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

/** A blank fragment inside an idea, which is the only shape a fragment has. */
function seedFragment(): string {
  const store = useContentStore.getState();
  const ideaId = store.createIdea({ title: "Roadmaps" });
  return store.createPiece({
    ideaId,
    format: "essay",
    origin: "user",
    status: "in-progress",
  });
}

/** A fragment with every context field filled, so the prompt has metadata to carry. */
function seedWrittenFragment(): string {
  const id = seedFragment();
  useContentStore.getState().updatePiece(id, {
    title: "Untitled draft",
    body: DRAFT,
    goal: "Convince skeptical CTOs to cut their roadmap",
    audience: "Engineering leaders at 50-person startups",
    tone: "Direct, no hedging",
    remember: "Never name a specific vendor",
  });
  return id;
}

function connectProvider(): void {
  useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
  useSettingsStore.getState().updateProviderCredentials({ openRouterApiKey: "sk-test-key" });
}

async function runGenerate(pieceId: string, content: string): Promise<void> {
  const { result } = renderHook(() => useGenerateTitle());
  await act(async () => {
    await result.current.generateTitle(pieceId, content);
  });
}

describe("useGenerateTitle", () => {
  beforeEach(() => {
    postGenerate.mockReset();
    useContentStore.setState({ ideas: {}, pieces: {}, resources: {}, hydrated: true });
    useAppStore.setState({ aiGate: null, badProviders: new Set() });
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
  });

  it("sends the draft and every context field, then applies the cleaned title", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ content: '**"Two Roadmaps"**' }));

    const id = seedWrittenFragment();
    await runGenerate(id, DRAFT);

    expect(postGenerate).toHaveBeenCalledTimes(1);
    const body = JSON.parse(postGenerate.mock.calls[0][0] as string);
    expect(body.promptTemplate).toBe(DEFAULT_TITLE_PROMPT);
    expect(body.contextAbove).toContain("two roadmaps");
    expect(body.goal).toBe("Convince skeptical CTOs to cut their roadmap");
    expect(body.audience).toBe("Engineering leaders at 50-person startups");
    expect(body.tone).toBe("Direct, no hedging");
    expect(body.remember).toBe("Never name a specific vendor");

    expect(useContentStore.getState().pieces[id].title).toBe("Two Roadmaps");
  });

  it("falls back to the fragment's saved text when the editor passes nothing", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ content: "Two Roadmaps" }));

    const id = seedWrittenFragment();
    await runGenerate(id, "");

    const body = JSON.parse(postGenerate.mock.calls[0][0] as string);
    expect(body.contextAbove).toBe(DRAFT);
  });

  it("opens the connection gate instead of calling out when no provider is connected", async () => {
    postGenerate.mockResolvedValue(jsonResponse({ content: "Two Roadmaps" }));

    const id = seedWrittenFragment();
    await runGenerate(id, DRAFT);

    expect(postGenerate).not.toHaveBeenCalled();
    expect(useAppStore.getState().aiGate).toEqual({ reason: "no-provider", provider: undefined });
    expect(useContentStore.getState().pieces[id].title).toBe("Untitled draft");
  });

  it("leaves the existing title alone when the request fails", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ error: "Generation failed" }, 500));

    const id = seedWrittenFragment();
    await runGenerate(id, DRAFT);

    expect(useContentStore.getState().pieces[id].title).toBe("Untitled draft");
  });

  it("leaves the existing title alone when the model returns nothing usable", async () => {
    connectProvider();
    postGenerate.mockResolvedValue(jsonResponse({ content: "   " }));

    const id = seedWrittenFragment();
    await runGenerate(id, DRAFT);

    expect(useContentStore.getState().pieces[id].title).toBe("Untitled draft");
  });

  it("never calls out for a fragment with nothing written in it", async () => {
    connectProvider();
    const id = seedFragment();

    await runGenerate(id, "");

    expect(postGenerate).not.toHaveBeenCalled();
  });

  it("never calls out for a fragment that is no longer there", async () => {
    connectProvider();

    await runGenerate("missing", DRAFT);

    expect(postGenerate).not.toHaveBeenCalled();
  });
});
