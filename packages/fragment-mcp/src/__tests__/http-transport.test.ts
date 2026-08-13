import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpTransport, resolveHttpConfig } from "../http-transport.js";
import { TransportError } from "../transport.js";
import { parsePieceHandoffJson } from "../../../../src/lib/content-engine/index.js";

/**
 * The hosted transport against a stubbed fetch: URL building, auth header,
 * and — the part that matters operationally — how server refusals surface.
 * A 401 must say "your token", a 404 must be a not_found the tools can
 * relay, and a network failure must name the base URL it couldn't reach.
 */

type FetchCall = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HttpTransport", () => {
  const calls: FetchCall[] = [];
  let nextResponse: Response;

  beforeEach(() => {
    calls.length = 0;
    nextResponse = jsonResponse(200, {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} });
        return nextResponse;
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const transport = new HttpTransport({
    baseUrl: "https://fragment.example/", // trailing slash on purpose
    apiKey: "frg_agent_test123",
  });

  it("sends the bearer token and normalizes the base URL", async () => {
    nextResponse = jsonResponse(200, { ideas: [] });
    await transport.listIdeas();

    expect(calls[0].url).toBe("https://fragment.example/api/v1/agent/ideas");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(
      "Bearer frg_agent_test123",
    );
  });

  it("passes the status filter through as a query parameter", async () => {
    nextResponse = jsonResponse(200, { ideas: [] });
    await transport.listIdeas("inbox");
    expect(calls[0].url).toBe("https://fragment.example/api/v1/agent/ideas?status=inbox");
  });

  it("POSTs the whole contract handoff for addPiece", async () => {
    nextResponse = jsonResponse(201, { pieceId: "pc_x", ideaId: "idea_y" });
    const handoff = parsePieceHandoffJson({
      fragment: 1,
      ideaTitle: "T",
      format: "tweet",
      body: "hello",
    });
    const result = await transport.addPiece(handoff);

    expect(result).toEqual({ pieceId: "pc_x", ideaId: "idea_y" });
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent.fragment).toBe(1);
    expect(sent.body).toBe("hello");
    expect((calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("URL-encodes piece ids", async () => {
    nextResponse = jsonResponse(200, { id: "a/b" });
    await transport.getPiece("a/b");
    expect(calls[0].url).toBe("https://fragment.example/api/v1/agent/pieces/a%2Fb");
  });

  it("maps 401 to a token-focused error", async () => {
    nextResponse = jsonResponse(401, { error: "Invalid or missing agent token" });
    await expect(transport.listIdeas()).rejects.toThrow(/FRAGMENT_API_TOKEN/);
  });

  it("maps 404 to not_found so tools can say what's missing", async () => {
    nextResponse = jsonResponse(404, { error: "piece not found: pc_zzz" });
    const err = await transport.getPiece("pc_zzz").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransportError);
    expect((err as TransportError).code).toBe("not_found");
    expect((err as TransportError).message).toContain("pc_zzz");
  });

  it("relays the server's message on 400", async () => {
    nextResponse = jsonResponse(400, { error: 'agents may only set status "published"' });
    await expect(transport.updateStatus("pc_1", "ready")).rejects.toThrow(/only set status/);
  });

  it("names the unreachable base URL on network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("getaddrinfo ENOTFOUND");
      }),
    );
    await expect(transport.listIdeas()).rejects.toThrow(/fragment\.example/);
  });
});

describe("resolveHttpConfig", () => {
  const saved = { url: process.env.FRAGMENT_API_URL, token: process.env.FRAGMENT_API_TOKEN };

  afterEach(() => {
    if (saved.url === undefined) delete process.env.FRAGMENT_API_URL;
    else process.env.FRAGMENT_API_URL = saved.url;
    if (saved.token === undefined) delete process.env.FRAGMENT_API_TOKEN;
    else process.env.FRAGMENT_API_TOKEN = saved.token;
  });

  it("returns null when neither variable is set (local file mode)", () => {
    delete process.env.FRAGMENT_API_URL;
    delete process.env.FRAGMENT_API_TOKEN;
    expect(resolveHttpConfig()).toBeNull();
  });

  it("returns the pair when both are set", () => {
    process.env.FRAGMENT_API_URL = "https://fragment.example";
    process.env.FRAGMENT_API_TOKEN = "frg_agent_abc";
    expect(resolveHttpConfig()).toEqual({
      baseUrl: "https://fragment.example",
      apiKey: "frg_agent_abc",
    });
  });

  it("fails loudly on a half-configured pair instead of silently writing files", () => {
    process.env.FRAGMENT_API_URL = "https://fragment.example";
    delete process.env.FRAGMENT_API_TOKEN;
    expect(() => resolveHttpConfig()).toThrow(/FRAGMENT_API_TOKEN/);
  });
});
