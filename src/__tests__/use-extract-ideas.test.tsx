/**
 * A draft-row extraction closes its context menu before the model call returns.
 * The working state therefore has to live above that transient menu and reject
 * a repeat trigger, or the app looks idle while duplicate paid calls run.
 */

import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const postExtract = vi.fn();

vi.mock("@/lib/ai-client", () => ({
  postExtract: (...args: unknown[]) => postExtract(...args),
  isTauri: () => false,
}));

vi.mock("@/lib/ai/connection-status", () => ({
  resolveWorkingFeatureAuth: () => ({
    provider: "openrouter",
    model: "test-model",
    apiKey: "",
    present: true,
  }),
}));

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

import { useExtractIdeas } from "@/hooks/use-extract-ideas";
import { IdeaPanel } from "@/components/idea/idea-panel";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useSettingsStore } from "@/stores/settings-store";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function seedDraft(): string {
  const store = useContentStore.getState();
  const ideaId = store.createIdea({ title: "Extraction test" });
  return store.createPiece({
    ideaId,
    title: "Draft one",
    body: "A complete thought. ".repeat(40),
    format: "essay",
    origin: "user",
    status: "in-progress",
  });
}

describe("useExtractIdeas", () => {
  beforeEach(() => {
    cleanup();
    postExtract.mockReset();
    useContentStore.setState({ ideas: {}, pieces: {}, resources: {}, hydrated: true });
    useAppStore.setState({ aiGate: null, badProviders: new Set() });
    useSettingsStore.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
  });

  it("keeps the active draft visible and refuses a duplicate extraction", async () => {
    const releases: Array<(value: Response) => void> = [];
    postExtract.mockImplementation(
      () => new Promise<Response>((resolve) => releases.push(resolve)),
    );

    const draftId = seedDraft();
    const { result } = renderHook(() => useExtractIdeas());

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.extract({ kind: "piece", pieceId: draftId });
    });

    await waitFor(() => expect(result.current.isExtracting).toBe(true));
    const activeLabel = result.current.activeLabel;

    let second!: Promise<unknown>;
    act(() => {
      second = result.current.extract({ kind: "piece", pieceId: draftId });
    });
    const callsWhileActive = postExtract.mock.calls.length;

    await act(async () => {
      for (const release of releases) {
        release(response({ content: "[]" }));
      }
      await Promise.all([first, second]);
    });

    expect(activeLabel).toBe("Draft one");
    expect(callsWhileActive).toBe(1);
    expect(result.current.isExtracting).toBe(false);
    expect(result.current.activeLabel).toBeNull();
  });

  it("keeps right-click extraction visible after the draft menu closes", async () => {
    let release!: (value: Response) => void;
    postExtract.mockImplementation(
      () => new Promise<Response>((resolve) => { release = resolve; }),
    );

    const draftId = seedDraft();
    const ideaId = useContentStore.getState().pieces[draftId].ideaId;
    render(<IdeaPanel ideaId={ideaId} />);

    const draftRow = screen.getByText("Draft one").closest('[role="button"]');
    expect(draftRow).not.toBeNull();
    fireEvent.contextMenu(draftRow!, { clientX: 80, clientY: 80 });
    fireEvent.click(screen.getByText("Extract pieces from this draft"));

    const progress = await screen.findByRole("button", {
      name: "Extracting from Draft one…",
    });
    expect(progress).toBeDisabled();
    expect(screen.queryByText("Extract pieces from this draft")).toBeNull();

    await act(async () => {
      release(response({ content: "[]" }));
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Extract from the whole idea" })).toBeEnabled();
    });
  });

  it("stages extracted results for review instead of putting them in Inbox", async () => {
    postExtract.mockResolvedValue(
      response({ content: JSON.stringify([{ title: "Found thought", body: "Worth reviewing" }]) }),
    );

    const draftId = seedDraft();
    const { result } = renderHook(() => useExtractIdeas());

    await act(async () => {
      await result.current.extract({ kind: "piece", pieceId: draftId });
    });

    const created = Object.values(useContentStore.getState().pieces).find(
      (piece) => piece.id !== draftId,
    );
    expect(created).toMatchObject({
      title: "Found thought",
      status: "in-progress",
      reviewQueue: "extraction",
      origin: "user",
    });
  });
});
