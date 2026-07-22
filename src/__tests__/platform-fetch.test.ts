import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tauriFetchMock = vi.fn();

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: tauriFetchMock,
}));

function setTauriRuntime(enabled: boolean) {
  if (enabled) {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  } else {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  }
}

describe("codexFetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    tauriFetchMock.mockReset();
    tauriFetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    setTauriRuntime(false);
  });

  afterEach(() => {
    setTauriRuntime(false);
    vi.unstubAllGlobals();
  });

  it("uses global fetch for chatgpt.com when not running in Tauri", async () => {
    const { codexFetch } = await import("@/lib/platform-fetch");
    await codexFetch("https://chatgpt.com/backend-api/codex/responses", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tauriFetchMock).not.toHaveBeenCalled();
  });

  it("uses the Tauri HTTP plugin for chatgpt.com when running in Tauri", async () => {
    setTauriRuntime(true);
    const { codexFetch } = await import("@/lib/platform-fetch");
    await codexFetch("https://chatgpt.com/backend-api/codex/responses", { method: "POST" });

    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    expect(tauriFetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      { method: "POST" },
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses global fetch for non-chatgpt.com URLs even when running in Tauri", async () => {
    setTauriRuntime(true);
    const { codexFetch } = await import("@/lib/platform-fetch");
    await codexFetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tauriFetchMock).not.toHaveBeenCalled();
  });

  it("resolves the hostname from a Request object, not just string URLs", async () => {
    setTauriRuntime(true);
    const { codexFetch } = await import("@/lib/platform-fetch");
    const req = new Request("https://chatgpt.com/backend-api/codex/models");
    await codexFetch(req);

    expect(tauriFetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to global fetch when the URL can't be parsed", async () => {
    setTauriRuntime(true);
    const { codexFetch } = await import("@/lib/platform-fetch");
    await codexFetch("/api/relative-path");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tauriFetchMock).not.toHaveBeenCalled();
  });
});
