import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

let POST: (req: { json: () => Promise<unknown> }) => Promise<unknown>;

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn());

  vi.doMock("next/server", () => ({
    NextRequest: vi.fn(),
    NextResponse: mockNextResponse,
  }));

  const mod = await import("@/app/api/analyze-voice/route");
  POST = mod.POST as typeof POST;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeReq(body: Record<string, unknown>) {
  return { json: () => Promise.resolve(body) } as Parameters<typeof POST>[0];
}

function okFetch(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
  });
}

describe("POST /api/analyze-voice", () => {
  it("substitutes {voiceName}, {description}, and {samples}", async () => {
    const fetchMock = okFetch('{"summary":"x"}');
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      voiceName: "Ada",
      description: "wry and precise",
      samplesText: "=== SAMPLE 1 ===\nHello world",
      promptTemplate: "Name:{voiceName} Desc:{description} Samples:{samples}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    await POST(req);

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("Name:Ada");
    expect(prompt).toContain("Desc:wry and precise");
    expect(prompt).toContain("Hello world");
  });

  it("does not mangle $-sequences in sample text (regression: String.replace $$/$&)", async () => {
    const fetchMock = okFetch('{"summary":"x"}');
    vi.stubGlobal("fetch", fetchMock);

    // $$ (LaTeX/markdown math), $& and $` are all special in a string replacement.
    const rawSamples = "Cost is $$5 and rising. See $& and $` too.";
    const req = makeReq({
      voiceName: "V",
      description: "d",
      samplesText: rawSamples,
      promptTemplate: "{samples}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    await POST(req);

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toBe(rawSamples);
  });

  it("does not let an injected {samples} in description hijack the real placeholder", async () => {
    const fetchMock = okFetch('{"summary":"x"}');
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      voiceName: "V",
      description: "sneaky {samples}",
      samplesText: "REAL SAMPLES",
      promptTemplate: "D:{description} S:{samples}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    await POST(req);

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    // The literal {samples} inside description must survive verbatim; the real
    // {samples} placeholder gets the sample text.
    expect(prompt).toBe("D:sneaky {samples} S:REAL SAMPLES");
  });

  it("uses fallback text for empty optional fields", async () => {
    const fetchMock = okFetch('{"summary":"x"}');
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      voiceName: "",
      description: "",
      samplesText: "",
      promptTemplate: "N:{voiceName} D:{description} S:{samples}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    await POST(req);

    const prompt = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(prompt).toContain("Untitled voice");
    expect(prompt).toContain("(none provided)");
    expect(prompt).toContain("(no samples provided)");
  });

  it("returns 400 for an invalid provider without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      voiceName: "V",
      samplesText: "s",
      promptTemplate: "{samples}",
      model: "test/model",
      provider: "not-a-provider",
      apiKey: "sk-test",
    });

    const res = (await POST(req)) as { body: { error: string }; status: number };
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when the provider is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));

    const req = makeReq({
      voiceName: "V",
      samplesText: "s",
      promptTemplate: "{samples}",
      model: "test/model",
      provider: "ollama",
    });

    const res = (await POST(req)) as { status: number };
    expect(res.status).toBe(503);
  });
});
