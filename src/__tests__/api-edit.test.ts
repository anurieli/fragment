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

  const mod = await import("@/app/api/edit/route");
  POST = mod.POST as typeof POST;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeReq(body: Record<string, unknown>, headers?: Record<string, string>) {
  return makeApiRequest(body, headers);
}

describe("POST /api/edit", () => {
  it("substitutes edit template variables and returns request context details", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => "application/json" },
      text: () => Promise.resolve(JSON.stringify({ choices: [{ message: { content: "Edited text" } }] })),
    });
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      selectedText: "rough draft",
      contextBefore: "before text",
      contextAfter: "after text",
      goal: "clarify",
      audience: "founders",
      tone: "direct",
      remember: "keep the point sharp",
      instruction: "Make this clearer",
      promptTemplate: "Goal:{goal} Before:{contextBefore} Selected:{selectedText} After:{contextAfter} Instruction:{instruction}",
      model: "test/model",
      provider: "openrouter",
      apiKey: "sk-test",
    });

    const res = (await POST(req)) as {
      body: {
        content: string;
        _meta?: {
          request?: {
            fields?: Array<{ key: string; length: number }>;
          };
        };
      };
      status: number;
    };

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const prompt = callBody.messages[0].content;
    expect(prompt).toContain("rough draft");
    expect(prompt).toContain("before text");
    expect(prompt).toContain("after text");
    expect(prompt).toContain("clarify");
    expect(prompt).toContain("Make this clearer");
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Edited text");
    expect(res.body._meta?.request?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "selectedText", length: "rough draft".length }),
        expect.objectContaining({ key: "contextBefore", length: "before text".length }),
        expect.objectContaining({ key: "contextAfter", length: "after text".length }),
        expect.objectContaining({ key: "instruction", length: "Make this clearer".length }),
      ]),
    );
  });

  it("returns 400 for an invalid provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const req = makeReq({
      selectedText: "rough draft",
      contextBefore: "",
      contextAfter: "",
      promptTemplate: "{selectedText}",
      model: "test/model",
      provider: "not-a-provider",
      apiKey: "sk-test",
    });

    const res = (await POST(req)) as { body: { error: string }; status: number };
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid provider");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
