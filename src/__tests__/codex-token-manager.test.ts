import { describe, it, expect, vi, beforeEach } from "vitest";

// The token manager keeps module-level session state (latestRefreshToken,
// sessionEpoch), so every test re-imports a fresh copy via resetModules.

const postCodexToken = vi.fn();

vi.mock("@/lib/ai-client", () => ({
  postCodexToken: (body: string) => postCodexToken(body),
}));

function okTokenResponse(accessToken: string, refreshToken: string): Response {
  return new Response(JSON.stringify({ accessToken, refreshToken }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadManager() {
  vi.resetModules();
  return import("@/lib/codex-token-manager");
}

describe("codex-token-manager disconnect behavior", () => {
  beforeEach(() => {
    postCodexToken.mockReset();
  });

  it("signed-out store (both tokens empty) never refreshes from module state — disconnect must stick", async () => {
    const mgr = await loadManager();
    // Simulate an earlier connected session that primed the module state.
    mgr.primeCodexRefreshToken("old-refresh-token");

    const onUpdate = vi.fn();
    // After disconnect the store holds empty strings for both tokens.
    const token = await mgr.ensureValidCodexToken("", "", onUpdate);

    expect(token).toBeNull();
    expect(postCodexToken).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("clearCodexSession wipes the module refresh token so forceRefresh cannot re-authenticate", async () => {
    const mgr = await loadManager();
    mgr.primeCodexRefreshToken("old-refresh-token");
    mgr.clearCodexSession();

    const onUpdate = vi.fn();
    const token = await mgr.forceRefreshCodexToken(onUpdate);

    expect(token).toBeNull();
    expect(postCodexToken).not.toHaveBeenCalled();
    // The empty-token wipe write is allowed; a token write-back is not.
    for (const call of onUpdate.mock.calls) {
      expect(call[0]).toEqual({ codexAccessToken: "", codexRefreshToken: "" });
    }
  });

  it("a refresh already in flight when the user disconnects does not write tokens back", async () => {
    const mgr = await loadManager();

    let releaseRefresh: (value: Response) => void = () => {};
    postCodexToken.mockReturnValue(
      new Promise<Response>((resolve) => {
        releaseRefresh = resolve;
      }),
    );

    const onUpdate = vi.fn();
    // Access token empty + refresh token present → triggers a refresh.
    const pending = mgr.ensureValidCodexToken("", "live-refresh-token", onUpdate);

    // Give the manager a tick to enter the refresh, then disconnect mid-flight.
    await new Promise((r) => setTimeout(r, 0));
    mgr.clearCodexSession();
    releaseRefresh(okTokenResponse("fresh-access", "fresh-refresh"));

    const token = await pending;

    expect(token).toBeNull();
    expect(onUpdate).not.toHaveBeenCalledWith({
      codexAccessToken: "fresh-access",
      codexRefreshToken: "fresh-refresh",
    });
  });

  it("normal path still works: empty access + live refresh token gets fresh tokens", async () => {
    const mgr = await loadManager();
    postCodexToken.mockResolvedValue(okTokenResponse("new-access", "new-refresh"));

    const onUpdate = vi.fn();
    const token = await mgr.ensureValidCodexToken("", "live-refresh-token", onUpdate);

    expect(token).toBe("new-access");
    expect(onUpdate).toHaveBeenCalledWith({
      codexAccessToken: "new-access",
      codexRefreshToken: "new-refresh",
    });
  });
});
