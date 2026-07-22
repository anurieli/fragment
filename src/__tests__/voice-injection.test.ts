import { describe, it, expect } from "vitest";
import { buildChatRequest, isChatRequestError } from "@/lib/ai/provider-runtime";

const KEY = "sk-test-123";

function bodyOf(req: ReturnType<typeof buildChatRequest>): Record<string, unknown> {
  if (isChatRequestError(req)) throw new Error(req.error);
  return JSON.parse(req.body) as Record<string, unknown>;
}

describe("voice injection through buildChatRequest", () => {
  it("openai-chat: prepends a system message when voiceContext is present", () => {
    const body = bodyOf(
      buildChatRequest({ provider: "openai", model: "gpt-4o", prompt: "hi", apiKey: KEY, stream: false, system: "VOICE" }),
    );
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: "VOICE" });
    expect(messages[1]).toEqual({ role: "user", content: "hi" });
  });

  it("anthropic: sets a top-level system field", () => {
    const body = bodyOf(
      buildChatRequest({ provider: "anthropic", model: "claude-sonnet-4-5", prompt: "hi", apiKey: KEY, stream: false, system: "VOICE" }),
    );
    expect(body.system).toBe("VOICE");
    const messages = body.messages as Array<{ role: string }>;
    expect(messages[0].role).toBe("user");
  });

  it("empty voiceContext ⇒ request body byte-identical to no-system (openai-chat)", () => {
    const withEmpty = buildChatRequest({ provider: "openai", model: "gpt-4o", prompt: "hi", apiKey: KEY, stream: false, system: "" });
    const without = buildChatRequest({ provider: "openai", model: "gpt-4o", prompt: "hi", apiKey: KEY, stream: false });
    if (isChatRequestError(withEmpty) || isChatRequestError(without)) throw new Error("unexpected error");
    expect(withEmpty.body).toBe(without.body);
  });

  it("empty voiceContext ⇒ no system field (anthropic)", () => {
    const body = bodyOf(
      buildChatRequest({ provider: "anthropic", model: "claude-sonnet-4-5", prompt: "hi", apiKey: KEY, stream: false, system: "" }),
    );
    expect("system" in body).toBe(false);
  });

  it("whitespace-only voiceContext is treated as empty", () => {
    const withWs = buildChatRequest({ provider: "openai", model: "gpt-4o", prompt: "hi", apiKey: KEY, stream: false, system: "   " });
    const without = buildChatRequest({ provider: "openai", model: "gpt-4o", prompt: "hi", apiKey: KEY, stream: false });
    if (isChatRequestError(withWs) || isChatRequestError(without)) throw new Error("unexpected error");
    expect(withWs.body).toBe(without.body);
  });
});
