import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { makeApiRequest, type ApiRequestDouble } from "./helpers/api-request";

// We test the route handler by importing and calling POST directly.
// Need to mock next/server and global fetch.

const mockNextRequest = vi.fn();
const mockNextResponse = {
  json: vi.fn((body: unknown, init?: { status?: number }) => ({
    body,
    status: init?.status ?? 200,
  })),
};

vi.mock("next/server", () => ({
  NextRequest: mockNextRequest,
  NextResponse: mockNextResponse,
}));

// We'll import the POST handler after mocking
let POST: (req: ApiRequestDouble) => Promise<unknown>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());

  // Re-mock next/server for fresh module
  vi.doMock("next/server", () => ({
    NextRequest: mockNextRequest,
    NextResponse: mockNextResponse,
  }));

  const mod = await import("@/app/api/label/route");
  POST = mod.POST as typeof POST;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeReq(body: Record<string, unknown>, headers?: Record<string, string>) {
  return makeApiRequest(body, headers);
}

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

describe("POST /api/label", () => {
  it("substitutes template variables in the prompt", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "Test Label" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      snippetContent: "My snippet",
      essayContent: "Full essay",
      goal: "persuade",
      promptTemplate: "Goal:{goal} Essay:{essayContent} Snippet:{snippetContent}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    const res = (await POST(req)) as {
      body: {
        _meta?: {
          request?: {
            fields?: Array<{ key: string; length: number }>;
          };
        };
      };
    };

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = callBody.messages[0].content;
    expect(prompt).toContain("My snippet");
    expect(prompt).toContain("Full essay");
    expect(prompt).toContain("persuade");
    expect(res.body._meta?.request?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "goal", length: "persuade".length }),
        expect.objectContaining({ key: "essayContent", length: "Full essay".length }),
        expect.objectContaining({ key: "snippetContent", length: "My snippet".length }),
      ]),
    );
  });

  it("routes to Ollama when provider is ollama", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: { content: "Ollama Label" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      snippetContent: "text",
      essayContent: "",
      goal: "",
      promptTemplate: "{snippetContent}",
      model: "llama3",
      provider: "ollama",
    });

    await POST(req);

    expect(fetchMock.mock.calls[0][0]).toContain("localhost:11434");
  });

  it("returns fallback when no API key for openrouter", async () => {
    // No env key, no client key
    delete process.env.OPENROUTER_API_KEY;

    const req = makeReq({
      snippetContent: "text",
      essayContent: "",
      goal: "",
      promptTemplate: "{snippetContent}",
      model: "test/model",
      provider: "openrouter",
    });

    const res = (await POST(req)) as { body: { label: string }; status: number };
    expect(res.body.label).toBe("AI labeling unavailable");
    expect(res.status).toBe(200);
  });

  it("routes Codex labeling to the ChatGPT Codex responses endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "text/event-stream" : null),
      },
      text: () => Promise.resolve(
        [
          "event: response.completed",
          "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Focused Claim\"}]}],\"usage\":{\"input_tokens\":7,\"output_tokens\":2,\"total_tokens\":9}}}",
          "",
        ].join("\n"),
      ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const codexToken = makeJwt({ chatgpt_account_id: "acct_456" });
    const req = makeReq({
      snippetContent: "text",
      essayContent: "",
      goal: "",
      promptTemplate: "{snippetContent}",
      model: "gpt-5.4-mini",
      provider: "codex",
      codexToken,
    });

    const res = (await POST(req)) as {
      status: number;
      body: { label: string; _meta: { promptTokens?: number } };
    };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://chatgpt.com/backend-api/codex/responses");
    const options = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(options.headers.Authorization).toBe(`Bearer ${codexToken}`);
    expect(options.headers["ChatGPT-Account-Id"]).toBe("acct_456");
    const parsedBody = JSON.parse(options.body) as Record<string, unknown>;
    expect(parsedBody.model).toBe("gpt-5.4-mini");
    expect(parsedBody.tool_choice).toBe("auto");
    expect(parsedBody.parallel_tool_calls).toBe(false);
    expect(parsedBody.stream).toBe(true);
    expect(parsedBody.instructions).toBe("");
    expect(res.status).toBe(200);
    expect(res.body.label).toBe("Focused Claim");
    expect(res.body._meta.promptTokens).toBe(7);
  });

  it("returns 400 for an invalid provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      snippetContent: "text",
      essayContent: "",
      goal: "",
      promptTemplate: "{snippetContent}",
      model: "test/model",
      provider: "not-a-provider",
      apiKey: "sk-test",
    });

    const res = (await POST(req)) as { body: { label: string }; status: number };
    expect(res.status).toBe(400);
    expect(res.body.label).toBe("Invalid provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns error status when OpenRouter request fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "application/json" },
      text: () => Promise.resolve(JSON.stringify({ error: { message: "rate limited" } })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      snippetContent: "text",
      essayContent: "",
      goal: "",
      promptTemplate: "{snippetContent}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    const res = (await POST(req)) as { body: { label: string }; status: number };
    expect(res.status).toBe(429);
    expect(res.body.label).toBe("AI labeling failed");
  });

  it("returns 503 when Ollama is not reachable", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      snippetContent: "text",
      essayContent: "",
      goal: "",
      promptTemplate: "{snippetContent}",
      model: "llama3",
      provider: "ollama",
    });

    const res = (await POST(req)) as { body: { label: string }; status: number };
    expect(res.status).toBe(503);
    expect(res.body.label).toBe("AI labeling failed");
  });
});

/**
 * The guards run before the handler reads the body, so they are the first
 * thing a request meets and the last thing anyone notices when they break.
 * These two pin them down, and by construction they only pass if the request
 * double carries real headers.
 */
describe("POST /api/label request guards", () => {
  it("refuses a body whose declared size is over the cap, without parsing it", async () => {
    const json = vi.fn();
    const req = { json, headers: new Headers({ "content-length": "2000000" }) };

    const res = (await POST(req)) as { body: { error: string }; status: number };
    expect(res.status).toBe(413);
    expect(json).not.toHaveBeenCalled();
  });

  it("rate limits one client past its per-window budget", async () => {
    const ip = "198.51.100.7";
    const spend = () =>
      POST(makeReq({ provider: "not-a-provider" }, { "x-forwarded-for": ip })) as Promise<{
        status: number;
      }>;

    // The budget is 20 per minute; each of these is rejected as a bad provider
    // but still counts, because the limiter runs first.
    for (let i = 0; i < 20; i++) {
      expect((await spend()).status).toBe(400);
    }

    expect((await spend()).status).toBe(429);

    // A different client is unaffected: the budget is per IP, not global.
    const other = (await POST(
      makeReq({ provider: "not-a-provider" }, { "x-forwarded-for": "198.51.100.8" }),
    )) as { status: number };
    expect(other.status).toBe(400);
  });
});
