/**
 * The ack is destructive: it moves a handoff file into `.imported/`, and
 * nothing ever re-reads that directory. So an ack is a promise that the piece
 * is safely on disk somewhere else. These tests pin the two ways that promise
 * used to be broken, both of which silently destroyed the last durable copy of
 * an agent's work:
 *
 *  1. IndexedDB refused the write, savePiece swallowed it, the ack fired anyway.
 *  2. The library failed to LOAD, so the store looked empty, so every pending
 *     piece looked new — re-imported at its file status (undoing triage) and
 *     then acked away.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { serializePieceFile } from "@/lib/content-engine";
import type { PieceHandoff } from "@/lib/content-engine";

const saveIdea = vi.fn();
const savePiece = vi.fn();
const saveResource = vi.fn();

vi.mock("@/lib/persistence", () => ({
  saveIdea: (...args: unknown[]) => saveIdea(...args),
  savePiece: (...args: unknown[]) => savePiece(...args),
  saveResource: (...args: unknown[]) => saveResource(...args),
}));

vi.mock("@/lib/ai-client", () => ({ isTauri: () => false }));

import { useAgentInbox } from "@/hooks/use-agent-inbox";
import { useContentStore } from "@/stores/content-store";

const handoff: PieceHandoff = {
  fragment: 1,
  id: "pc_test1",
  ideaTitle: "Society is changing",
  format: "linkedin",
  status: "inbox",
  origin: "agent",
  body: "Draft body.",
  priority: 0,
  resources: [],
};

/** Every fetch the hook makes, so we can assert on the ack specifically. */
let posts: { url: string; body: unknown }[] = [];

function installFetch() {
  posts = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          files: [
            {
              fileName: "pc_test1.md",
              relPath: "idea_x/pc_test1.md",
              content: serializePieceFile(handoff),
              mtime: 1000,
            },
          ],
          resourceFiles: [],
          ideaFiles: [],
        }),
        { status: 200 },
      );
    }),
  );
}

function ackedPaths(): string[] {
  return posts
    .filter((p) => p.url.includes("/ack"))
    .flatMap((p) => ((p.body as { imported?: string[] }).imported ?? []));
}

beforeEach(() => {
  saveIdea.mockReset().mockResolvedValue(true);
  savePiece.mockReset().mockResolvedValue(true);
  saveResource.mockReset().mockResolvedValue(true);
  useContentStore.setState({ ideas: {}, pieces: {}, resources: {}, hydrated: true, loadFailed: false });
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent inbox ack safety", () => {
  it("acks the handoff once every write is on disk", async () => {
    renderHook(() => useAgentInbox());

    await waitFor(() => expect(savePiece).toHaveBeenCalled());
    await waitFor(() => expect(ackedPaths()).toEqual(["idea_x/pc_test1.md"]));
  });

  it("withholds the ack when the piece write is refused", async () => {
    savePiece.mockResolvedValue(false);
    renderHook(() => useAgentInbox());

    await waitFor(() => expect(savePiece).toHaveBeenCalled());
    // Give the hook every chance to ack before asserting it didn't.
    await new Promise((r) => setTimeout(r, 20));
    expect(ackedPaths()).toEqual([]);
  });

  it("withholds the ack when a write rejects outright", async () => {
    savePiece.mockRejectedValue(new Error("QuotaExceededError"));
    renderHook(() => useAgentInbox());

    await waitFor(() => expect(savePiece).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(ackedPaths()).toEqual([]);
  });

  it("does not poll at all while the library failed to load", async () => {
    useContentStore.setState({ loadFailed: true });
    renderHook(() => useAgentInbox());

    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).not.toHaveBeenCalled();
    expect(savePiece).not.toHaveBeenCalled();
  });
});
