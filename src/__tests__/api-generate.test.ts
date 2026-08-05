import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { makeApiRequest, type ApiRequestDouble } from "./helpers/api-request";

const mockNextResponse = {
  json: vi.fn((body: unknown, init?: { status?: number }) => ({
    body,
    status: init?.status ?? 200,
  })),
};

vi.mock("next/server", () => ({
  NextRequest: vi.fn(),
  NextResponse: mockNextResponse,
}));

let POST: (req: ApiRequestDouble) => Promise<unknown>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());

  vi.doMock("next/server", () => ({
    NextRequest: vi.fn(),
    NextResponse: mockNextResponse,
  }));

  const mod = await import("@/app/api/generate/route");
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

describe("POST /api/generate", () => {
  it("substitutes all template variables", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "Generated text" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      contextAbove: "above text",
      contextBelow: "below text",
      goal: "inform",
      userInstruction: "add a transition",
      promptTemplate: "Goal:{goal} Above:{contextAbove} Below:{contextBelow} Instruction:{userInstruction}",
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
    expect(prompt).toContain("above text");
    expect(prompt).toContain("below text");
    expect(prompt).toContain("inform");
    expect(prompt).toContain("add a transition");
    expect(res.body._meta?.request?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "contextAbove", length: "above text".length }),
        expect.objectContaining({ key: "contextBelow", length: "below text".length }),
        expect.objectContaining({ key: "userInstruction", length: "add a transition".length }),
      ]),
    );
  });

  it("uses fallback text for empty optional fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ choices: [{ message: { content: "result" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      contextAbove: "",
      contextBelow: "",
      goal: "",
      userInstruction: "",
      promptTemplate: "Goal:{goal} Above:{contextAbove} Below:{contextBelow}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    await POST(req);

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = callBody.messages[0].content;
    expect(prompt).toContain("No specific goal set");
    expect(prompt).toContain("(beginning of document)");
    expect(prompt).toContain("(end of document)");
  });

  it("returns 401 when no API key for openrouter", async () => {
    delete process.env.OPENROUTER_API_KEY;

    const req = makeReq({
      contextAbove: "x",
      contextBelow: "x",
      goal: "",
      userInstruction: "",
      promptTemplate: "{contextAbove}",
      model: "test/model",
      provider: "openrouter",
    });

    const res = (await POST(req)) as { body: { error: string }; status: number };
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("No API key configured");
  });

  it("returns 400 for an invalid provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      contextAbove: "",
      contextBelow: "",
      goal: "",
      userInstruction: "",
      promptTemplate: "x",
      model: "test/model",
      provider: "not-a-provider",
      apiKey: "sk-test",
    });

    const res = (await POST(req)) as { body: { error: string }; status: number };
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes to Ollama when provider is ollama", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: { content: "Ollama result" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      contextAbove: "above",
      contextBelow: "below",
      goal: "",
      userInstruction: "write more",
      promptTemplate: "{contextAbove}",
      model: "llama3",
      provider: "ollama",
    });

    await POST(req);

    expect(fetchMock.mock.calls[0][0]).toContain("localhost:11434");
  });

  it("routes Codex provider to the ChatGPT Codex responses endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "text/event-stream" : null),
      },
      text: () => Promise.resolve(
        [
          "event: response.completed",
          "data: {\"type\":\"response.completed\",\"response\":{\"model\":\"gpt-5.4\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Codex output\"}]}],\"usage\":{\"input_tokens\":111,\"output_tokens\":22,\"total_tokens\":133}}}",
          "",
        ].join("\n"),
      ),
    });
    vi.stubGlobal("fetch", fetchMock);

    const codexToken = makeJwt({ chatgpt_account_id: "acct_123" });
    const req = makeReq({
      contextAbove: "above",
      contextBelow: "below",
      goal: "",
      userInstruction: "write more",
      promptTemplate: "{contextAbove}",
      model: "gpt-5.4",
      provider: "codex",
      codexToken,
    });

    const res = (await POST(req)) as {
      status: number;
      body: { content: string; _meta: { promptTokens?: number } };
    };

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://chatgpt.com/backend-api/codex/responses");
    const options = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(options.headers.Authorization).toBe(`Bearer ${codexToken}`);
    expect(options.headers["ChatGPT-Account-Id"]).toBe("acct_123");
    const parsedBody = JSON.parse(options.body) as Record<string, unknown>;
    expect(parsedBody.model).toBe("gpt-5.4");
    expect(parsedBody.tool_choice).toBe("auto");
    expect(parsedBody.parallel_tool_calls).toBe(false);
    expect(parsedBody.stream).toBe(true);
    expect(parsedBody.instructions).toBe("");
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Codex output");
    expect(res.body._meta.promptTokens).toBe(111);
  });

  it("returns 503 when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const req = makeReq({
      contextAbove: "",
      contextBelow: "",
      goal: "",
      userInstruction: "",
      promptTemplate: "x",
      model: "llama3",
      provider: "ollama",
    });

    const res = (await POST(req)) as { body: { error: string }; status: number };
    expect(res.status).toBe(503);
  });
});
