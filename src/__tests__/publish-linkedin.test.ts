import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  buildComposioRequest,
  composioErrorKind,
  composioErrorMessage,
  ComposioApiError,
  directComposioTransport,
  proxyComposioTransport,
  initiateLinkedInConnection,
  getConnectionStatus,
  publishLinkedInPost,
  canPublishToLinkedIn,
  COMPOSIO_API_BASE,
  LINKEDIN_TOOLKIT_SLUG,
  LINKEDIN_GET_MY_INFO_TOOL,
  LINKEDIN_CREATE_POST_TOOL,
  type ComposioAction,
  type ComposioTransport,
} from "@/lib/composio/linkedin";

// No real Composio account was available in this environment — every test
// below mocks the network (either directly via `fetch`, or by injecting a
// fake `ComposioTransport`) rather than hitting backend.composio.dev.

// ---------------------------------------------------------------------------
// buildComposioRequest — pure, no network
// ---------------------------------------------------------------------------

describe("buildComposioRequest", () => {
  it("link: POSTs to /connected_accounts/link with the LinkedIn toolkit and x-api-key header", () => {
    const req = buildComposioRequest("key_abc", { kind: "link", userId: "user-1" });
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${COMPOSIO_API_BASE}/connected_accounts/link`);
    expect(req.headers["x-api-key"]).toBe("key_abc");
    expect(req.headers["Content-Type"]).toBe("application/json");
    expect(req.body).toEqual({ toolkit: LINKEDIN_TOOLKIT_SLUG, user_id: "user-1" });
  });

  it("status: GETs /connected_accounts/{id}, no body", () => {
    const req = buildComposioRequest("key_abc", { kind: "status", connectedAccountId: "ca_123" });
    expect(req.method).toBe("GET");
    expect(req.url).toBe(`${COMPOSIO_API_BASE}/connected_accounts/ca_123`);
    expect(req.body).toBeUndefined();
  });

  it("status: URL-encodes the connected account id", () => {
    const req = buildComposioRequest("key", { kind: "status", connectedAccountId: "ca/weird id" });
    expect(req.url).toBe(`${COMPOSIO_API_BASE}/connected_accounts/${encodeURIComponent("ca/weird id")}`);
  });

  it("execute: POSTs to /tools/execute/{toolSlug} with arguments, connected_account_id, user_id", () => {
    const req = buildComposioRequest("key_abc", {
      kind: "execute",
      toolSlug: LINKEDIN_CREATE_POST_TOOL,
      connectedAccountId: "ca_123",
      userId: "user-1",
      arguments: { commentary: "hello", author: "urn:li:person:xyz" },
    });
    expect(req.method).toBe("POST");
    expect(req.url).toBe(`${COMPOSIO_API_BASE}/tools/execute/${LINKEDIN_CREATE_POST_TOOL}`);
    expect(req.body).toEqual({
      arguments: { commentary: "hello", author: "urn:li:person:xyz" },
      connected_account_id: "ca_123",
      user_id: "user-1",
    });
  });
});

// ---------------------------------------------------------------------------
// composioErrorKind / composioErrorMessage — pure status/body -> kind/message
// ---------------------------------------------------------------------------

describe("composioErrorKind", () => {
  it("401/403 map to invalid_key by default", () => {
    expect(composioErrorKind(401, undefined)).toBe("invalid_key");
    expect(composioErrorKind(403, undefined)).toBe("invalid_key");
  });

  it("401 with 'expired'/'reconnect' language in the detail maps to connection_expired, not invalid_key", () => {
    expect(composioErrorKind(401, { message: "Connection expired, please reconnect" })).toBe(
      "connection_expired",
    );
  });

  it("401 with 'revoked' language maps to connection_revoked", () => {
    expect(composioErrorKind(401, { error: { message: "Access was revoked by the user" } })).toBe(
      "connection_revoked",
    );
  });

  it("429 maps to rate_limited", () => {
    expect(composioErrorKind(429, undefined)).toBe("rate_limited");
  });

  it("422 maps to validation", () => {
    expect(composioErrorKind(422, undefined)).toBe("validation");
  });

  it("unmapped status falls back to unknown", () => {
    expect(composioErrorKind(500, undefined)).toBe("unknown");
  });
});

describe("composioErrorMessage", () => {
  it("invalid_key: hints at the Composio key in Settings → Integrations", () => {
    const msg = composioErrorMessage(401, undefined);
    expect(msg.toLowerCase()).toContain("api key");
    expect(msg).toContain("Settings");
  });

  it("connection_expired: hints at reconnecting", () => {
    const msg = composioErrorMessage(401, { message: "token expired" });
    expect(msg.toLowerCase()).toContain("reconnect");
  });

  it("connection_revoked: hints at reconnecting", () => {
    const msg = composioErrorMessage(401, { message: "revoked by user" });
    expect(msg.toLowerCase()).toContain("reconnect");
  });

  it("rate_limited: mentions the rate limit", () => {
    expect(composioErrorMessage(429, undefined).toLowerCase()).toContain("rate limit");
  });

  it("validation: surfaces the detail from the error body", () => {
    const msg = composioErrorMessage(422, { error: { message: "commentary is required" } });
    expect(msg).toContain("commentary is required");
  });

  it("unknown status: includes the status code", () => {
    expect(composioErrorMessage(500, undefined)).toContain("500");
  });
});

// ---------------------------------------------------------------------------
// canPublishToLinkedIn — pure eligibility gating
// ---------------------------------------------------------------------------

describe("canPublishToLinkedIn", () => {
  it("true when both a key and a connected account id are present", () => {
    expect(canPublishToLinkedIn("comp_key", "ca_123")).toBe(true);
  });

  it("false when the key is missing/blank", () => {
    expect(canPublishToLinkedIn(undefined, "ca_123")).toBe(false);
    expect(canPublishToLinkedIn("", "ca_123")).toBe(false);
    expect(canPublishToLinkedIn("   ", "ca_123")).toBe(false);
  });

  it("false when the connected account id is missing/blank", () => {
    expect(canPublishToLinkedIn("comp_key", undefined)).toBe(false);
    expect(canPublishToLinkedIn("comp_key", "")).toBe(false);
  });

  it("false when both are missing", () => {
    expect(canPublishToLinkedIn(undefined, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transports — directComposioTransport (fetch) and proxyComposioTransport
// (fetch against the local proxy route), both fully mocked.
// ---------------------------------------------------------------------------

describe("directComposioTransport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls backend.composio.dev directly with the built request", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const result = await directComposioTransport("key_abc", { kind: "status", connectedAccountId: "ca_1" });

    expect(fetchMock).toHaveBeenCalledWith(
      `${COMPOSIO_API_BASE}/connected_accounts/ca_1`,
      expect.objectContaining({ method: "GET", headers: expect.objectContaining({ "x-api-key": "key_abc" }) }),
    );
    expect(result).toEqual({ status: 200, body: { ok: true } });
  });
});

describe("proxyComposioTransport", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs the raw action to the local proxy route with the key in the Authorization header, never the body", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const action: ComposioAction = { kind: "status", connectedAccountId: "ca_1" };
    await proxyComposioTransport("secret_key", action);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/publish/linkedin");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret_key");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toEqual(action);
    expect(JSON.stringify(sentBody)).not.toContain("secret_key");
  });
});

// ---------------------------------------------------------------------------
// initiateLinkedInConnection / getConnectionStatus / publishLinkedInPost —
// network-shaped logic exercised through an injected fake ComposioTransport,
// so no fetch/window mocking is needed to test the orchestration itself.
// ---------------------------------------------------------------------------

function fakeTransport(
  handler: (action: ComposioAction) => { status: number; body: unknown },
): ComposioTransport {
  return async (_apiKey, action) => handler(action);
}

describe("initiateLinkedInConnection", () => {
  it("returns the redirect URL and connected account id on success", async () => {
    const transport = fakeTransport(() => ({
      status: 200,
      body: { redirect_url: "https://composio.dev/connect/abc", connected_account_id: "ca_new" },
    }));

    const result = await initiateLinkedInConnection("key", transport);
    expect(result).toEqual({ redirectUrl: "https://composio.dev/connect/abc", connectedAccountId: "ca_new" });
  });

  it("also accepts a top-level 'id' field for the connected account id", async () => {
    const transport = fakeTransport(() => ({
      status: 201,
      body: { redirectUrl: "https://composio.dev/connect/abc", id: "ca_new" },
    }));
    const result = await initiateLinkedInConnection("key", transport);
    expect(result.connectedAccountId).toBe("ca_new");
  });

  it("throws a ComposioApiError when the response is missing the redirect url", async () => {
    const transport = fakeTransport(() => ({ status: 200, body: {} }));
    await expect(initiateLinkedInConnection("key", transport)).rejects.toBeInstanceOf(ComposioApiError);
  });

  it("throws a ComposioApiError with invalid_key kind on 401", async () => {
    const transport = fakeTransport(() => ({ status: 401, body: { message: "bad key" } }));
    await expect(initiateLinkedInConnection("bad", transport)).rejects.toMatchObject({
      status: 401,
      kind: "invalid_key",
    });
  });

  it("wraps a transport network failure as a network ComposioApiError", async () => {
    const transport: ComposioTransport = async () => {
      throw new Error("fetch failed");
    };
    await expect(initiateLinkedInConnection("key", transport)).rejects.toMatchObject({ kind: "network" });
  });
});

describe("getConnectionStatus", () => {
  it("normalizes an ACTIVE status and pulls the alias as the account label", async () => {
    const transport = fakeTransport(() => ({
      status: 200,
      body: { status: "ACTIVE", alias: "ariel@fragment" },
    }));
    const result = await getConnectionStatus("key", "ca_1", transport);
    expect(result).toEqual({ status: "active", accountLabel: "ariel@fragment" });
  });

  it("normalizes EXPIRED / REVOKED / INITIATED / an unknown value", async () => {
    const cases: [string, string][] = [
      ["EXPIRED", "expired"],
      ["REVOKED", "revoked"],
      ["INITIATED", "initiated"],
      ["SOMETHING_NEW", "unknown"],
    ];
    for (const [raw, expected] of cases) {
      const transport = fakeTransport(() => ({ status: 200, body: { status: raw } }));
      const result = await getConnectionStatus("key", "ca_1", transport);
      expect(result.status).toBe(expected);
    }
  });

  it("falls back to state.val.account_id for the label when there's no alias", async () => {
    const transport = fakeTransport(() => ({
      status: 200,
      body: { status: "ACTIVE", state: { val: { account_id: "12345" } } },
    }));
    const result = await getConnectionStatus("key", "ca_1", transport);
    expect(result.accountLabel).toBe("12345");
  });

  it("throws ComposioApiError on a non-2xx response", async () => {
    const transport = fakeTransport(() => ({ status: 404, body: { message: "not found" } }));
    await expect(getConnectionStatus("key", "ca_missing", transport)).rejects.toBeInstanceOf(ComposioApiError);
  });
});

describe("publishLinkedInPost", () => {
  it("rejects text over the 3000-character LinkedIn limit before any network call", async () => {
    const transport = vi.fn();
    const overLimit = "x".repeat(3001);

    await expect(publishLinkedInPost("key", "ca_1", overLimit, transport as unknown as ComposioTransport)).rejects.toMatchObject(
      { kind: "over_limit" },
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("escapes LinkedIn reserved characters before sending the commentary", async () => {
    const calls: ComposioAction[] = [];
    const transport = fakeTransport((action) => {
      calls.push(action);
      if (action.kind === "execute" && action.toolSlug === LINKEDIN_GET_MY_INFO_TOOL) {
        return { status: 200, body: { data: { id: "12345" } } };
      }
      return { status: 200, body: { data: { id: "urn:li:share:999" } } };
    });

    await publishLinkedInPost("key", "ca_1", "Hello (world) #cool", transport);

    const createPostCall = calls.find(
      (c) => c.kind === "execute" && c.toolSlug === LINKEDIN_CREATE_POST_TOOL,
    );
    expect(createPostCall).toMatchObject({
      kind: "execute",
      arguments: { commentary: "Hello \\(world\\) \\#cool", author: "urn:li:person:12345" },
    });
  });

  it("resolves the author URN via LINKEDIN_GET_MY_INFO, then creates the post, and returns a derived post URL", async () => {
    const transport = fakeTransport((action) => {
      if (action.kind === "execute" && action.toolSlug === LINKEDIN_GET_MY_INFO_TOOL) {
        return { status: 200, body: { data: { id: "999" } } };
      }
      if (action.kind === "execute" && action.toolSlug === LINKEDIN_CREATE_POST_TOOL) {
        return { status: 200, body: { data: { id: "urn:li:share:abc" } } };
      }
      throw new Error("unexpected action");
    });

    const result = await publishLinkedInPost("key", "ca_1", "Hello world", transport);
    expect(result.externalId).toBe("urn:li:share:abc");
    expect(result.url).toBe(`https://www.linkedin.com/feed/update/${encodeURIComponent("urn:li:share:abc")}/`);
  });

  it("passes an already-prefixed author URN through unchanged", async () => {
    const calls: ComposioAction[] = [];
    const transport = fakeTransport((action) => {
      calls.push(action);
      if (action.kind === "execute" && action.toolSlug === LINKEDIN_GET_MY_INFO_TOOL) {
        return { status: 200, body: { data: { author: "urn:li:person:abc123" } } };
      }
      return { status: 200, body: { data: {} } };
    });

    await publishLinkedInPost("key", "ca_1", "hi", transport);
    const createPostCall = calls.find(
      (c) => c.kind === "execute" && c.toolSlug === LINKEDIN_CREATE_POST_TOOL,
    );
    expect(createPostCall).toMatchObject({ arguments: { author: "urn:li:person:abc123" } });
  });

  it("throws a ComposioApiError if the author URN can't be resolved", async () => {
    const transport = fakeTransport(() => ({ status: 200, body: { data: {} } }));
    await expect(publishLinkedInPost("key", "ca_1", "hi", transport)).rejects.toBeInstanceOf(ComposioApiError);
  });

  it("surfaces connection_expired when the create-post call reports an expired connection", async () => {
    const transport = fakeTransport((action) => {
      if (action.kind === "execute" && action.toolSlug === LINKEDIN_GET_MY_INFO_TOOL) {
        return { status: 200, body: { data: { id: "999" } } };
      }
      return { status: 401, body: { message: "Connection expired — please reconnect." } };
    });

    await expect(publishLinkedInPost("key", "ca_1", "hi", transport)).rejects.toMatchObject({
      kind: "connection_expired",
    });
  });

  it("surfaces rate_limited (429) from the create-post call", async () => {
    const transport = fakeTransport((action) => {
      if (action.kind === "execute" && action.toolSlug === LINKEDIN_GET_MY_INFO_TOOL) {
        return { status: 200, body: { data: { id: "999" } } };
      }
      return { status: 429, body: undefined };
    });

    await expect(publishLinkedInPost("key", "ca_1", "hi", transport)).rejects.toMatchObject({
      kind: "rate_limited",
      status: 429,
    });
  });
});
