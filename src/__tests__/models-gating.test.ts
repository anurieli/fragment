import { describe, it, expect } from "vitest";
import { buildModelsRequest, getStaticModels } from "@/lib/ai/provider-runtime";

/**
 * A provider the user has not connected must not have its catalogue listed.
 * OpenRouter's /models endpoint is public, which is how the model picker used
 * to fill with hundreds of models (Gemini, DeepSeek, and the rest) for someone
 * whose only connection was ChatGPT.
 */
describe("model listing is gated on a credential", () => {
  it("refuses to build an OpenRouter model request without a key", () => {
    expect(buildModelsRequest("openrouter", {})).toBeNull();
    expect(buildModelsRequest("openrouter", { apiKey: "   " })).toBeNull();
  });

  it("builds one once a key is present", () => {
    const req = buildModelsRequest("openrouter", { apiKey: "sk-or-test" });
    expect(req?.url).toContain("openrouter.ai");
    expect(req?.headers.Authorization).toBe("Bearer sk-or-test");
  });

  it("gates OpenAI and Anthropic the same way", () => {
    expect(buildModelsRequest("openai", {})).toBeNull();
    expect(buildModelsRequest("anthropic", {})).toBeNull();
    expect(buildModelsRequest("openai", { apiKey: "sk-test" })).not.toBeNull();
    expect(buildModelsRequest("anthropic", { apiKey: "sk-ant-test" })).not.toBeNull();
  });

  it("still needs a Codex token for Codex, and none for local Ollama", () => {
    expect(buildModelsRequest("codex", {})).toBeNull();
    expect(buildModelsRequest("codex", { codexToken: "tok" })).not.toBeNull();
    expect(buildModelsRequest("ollama", {})).not.toBeNull();
  });

  it("leaves Perplexity's curated list in place (the route gates it on the key)", () => {
    expect(getStaticModels("perplexity")?.length).toBeGreaterThan(0);
  });
});
