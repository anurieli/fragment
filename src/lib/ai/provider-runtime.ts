/**
 * Provider runtime — the single home for per-provider request/response logic.
 *
 * Pure module: NO React, NO lucide, NO next/server. Imported by both the
 * Next.js route handlers (server) and the Tauri client mirror (ai-client.ts),
 * so each provider's wire format is defined exactly once.
 *
 * Four protocols cover every provider:
 *   - openai-chat        → openrouter, openai, perplexity (OpenAI chat-completions)
 *   - anthropic-messages → anthropic (Anthropic Messages API)
 *   - openai-responses   → codex (OpenAI Responses API via ChatGPT OAuth)
 *   - ollama-chat        → ollama (local)
 */

import type { ProviderCredentials, ProviderModel } from "../types";
import { isHosted } from "../edition";
import {
  buildCodexHeaders,
  buildCodexResponsesBody,
  CODEX_RESPONSES_URL,
  CODEX_MODELS_URL,
  extractCodexErrorMessage,
  normalizeCodexModelId,
  parseCodexResponseBody,
  extractCodexResponseModel,
  extractCodexResponseText,
  extractCodexResponseUsage,
} from "../codex-api";
import {
  ANTHROPIC_MESSAGES_URL,
  ANTHROPIC_MODELS_URL,
  buildAnthropicBody,
  buildAnthropicHeaders,
  extractAnthropicError,
  parseAnthropicCompletion,
  parseAnthropicModels,
  transformAnthropicStream,
} from "./anthropic-api";

export type ProviderProtocol =
  | "openai-chat"
  | "anthropic-messages"
  | "openai-responses"
  | "ollama-chat";

interface ProviderConfigEntry {
  protocol: ProviderProtocol;
  baseUrl: string;
  chatEndpoint: string;
  modelsEndpoint?: string;
  /** Which ProviderCredentials field holds this provider's API key (api-key providers only). */
  keyField?: keyof ProviderCredentials;
  /** Server-side env var fallback (self-hosters running the Next.js server). */
  envVar?: string;
  /** Default model used when none is requested (preserves historical behaviour). */
  runtimeDefaultModel: string;
  /** Anthropic requires max_tokens; carried here. */
  maxTokens?: number;
  /** Fallback model list for providers without a /models endpoint (Perplexity). */
  staticModels?: ProviderModel[];
}

const PERPLEXITY_MODELS: ProviderModel[] = [
  { id: "sonar", name: "Sonar", provider: "perplexity" },
  { id: "sonar-pro", name: "Sonar Pro", provider: "perplexity" },
  { id: "sonar-reasoning", name: "Sonar Reasoning", provider: "perplexity" },
  { id: "sonar-reasoning-pro", name: "Sonar Reasoning Pro", provider: "perplexity" },
];

export const PROVIDER_IDS = [
  "openrouter",
  "openai",
  "perplexity",
  "anthropic",
  "codex",
  "ollama",
] as const;

export type AIProvider = (typeof PROVIDER_IDS)[number];

export const PROVIDER_CONFIG: Record<AIProvider, ProviderConfigEntry> = {
  openrouter: {
    protocol: "openai-chat",
    baseUrl: "https://openrouter.ai/api/v1",
    chatEndpoint: "https://openrouter.ai/api/v1/chat/completions",
    modelsEndpoint: "https://openrouter.ai/api/v1/models",
    keyField: "openRouterApiKey",
    envVar: "OPENROUTER_API_KEY",
    runtimeDefaultModel: "google/gemini-2.0-flash-001",
  },
  openai: {
    protocol: "openai-chat",
    baseUrl: "https://api.openai.com/v1",
    chatEndpoint: "https://api.openai.com/v1/chat/completions",
    modelsEndpoint: "https://api.openai.com/v1/models",
    keyField: "openAiApiKey",
    envVar: "OPENAI_API_KEY",
    runtimeDefaultModel: "gpt-4o-mini",
  },
  perplexity: {
    protocol: "openai-chat",
    baseUrl: "https://api.perplexity.ai",
    chatEndpoint: "https://api.perplexity.ai/chat/completions",
    keyField: "perplexityApiKey",
    envVar: "PERPLEXITY_API_KEY",
    runtimeDefaultModel: "sonar",
    staticModels: PERPLEXITY_MODELS,
  },
  anthropic: {
    protocol: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
    chatEndpoint: ANTHROPIC_MESSAGES_URL,
    modelsEndpoint: ANTHROPIC_MODELS_URL,
    keyField: "anthropicApiKey",
    envVar: "ANTHROPIC_API_KEY",
    runtimeDefaultModel: "claude-sonnet-4-5",
    maxTokens: 4096,
  },
  codex: {
    protocol: "openai-responses",
    baseUrl: "https://chatgpt.com/backend-api/codex",
    chatEndpoint: CODEX_RESPONSES_URL,
    modelsEndpoint: CODEX_MODELS_URL,
    runtimeDefaultModel: "gpt-4o-mini",
  },
  ollama: {
    protocol: "ollama-chat",
    baseUrl: "http://localhost:11434",
    chatEndpoint: "http://localhost:11434/api/chat",
    modelsEndpoint: "http://localhost:11434/api/tags",
    runtimeDefaultModel: "llama3",
  },
};

export function getProviderConfig(provider: AIProvider): ProviderConfigEntry {
  return PROVIDER_CONFIG[provider];
}

export function isAIProvider(value: unknown): value is AIProvider {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** True for providers authenticated with a plain API key (not OAuth/none). */
export function isApiKeyProvider(provider: AIProvider): boolean {
  return Boolean(PROVIDER_CONFIG[provider].keyField);
}

export function getProtocol(provider: AIProvider): ProviderProtocol {
  return PROVIDER_CONFIG[provider].protocol;
}

/** Strip surrounding quotes / a leading "Bearer " from a pasted API key. */
export function normalizeApiKey(rawKey?: string): string | null {
  let key = (rawKey || "").trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  if (!key) return null;
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  return key || null;
}

/** The user's stored API key for a provider, or "" for OAuth/local providers. */
export function getProviderKey(provider: AIProvider, creds: ProviderCredentials): string {
  const field = PROVIDER_CONFIG[provider].keyField;
  return field ? (creds[field] || "") : "";
}

/** Which ProviderCredentials field holds this provider's API key (or undefined). */
export function getProviderKeyField(provider: AIProvider): keyof ProviderCredentials | undefined {
  return PROVIDER_CONFIG[provider].keyField;
}

/**
 * Server-side env-var fallback key for a provider (Next.js server only).
 *
 * Managed AI — serving the deployment's OWN provider key — is OFF by default.
 * Without this gate, any anonymous request that simply omits `apiKey` would
 * drain the server's provider credit (see docs/exec-plans/production-readiness.md,
 * Phase 0). It stays disabled until there is authenticated, quota'd access
 * (Phase 1). To turn it on for a hosted build that has that in place, set both
 * NEXT_PUBLIC_FRAGMENT_HOSTED=true and FRAGMENT_ENABLE_MANAGED_AI=true.
 */
export function getServerEnvKey(provider: AIProvider): string | undefined {
  if (typeof process === "undefined") return undefined;
  if (!isHosted() || process.env?.FRAGMENT_ENABLE_MANAGED_AI !== "true") return undefined;
  const envVar = PROVIDER_CONFIG[provider].envVar;
  if (!envVar) return undefined;
  return process.env?.[envVar];
}

export function resolveModel(provider: AIProvider, requestedModel: string): string {
  const resolved = requestedModel || PROVIDER_CONFIG[provider].runtimeDefaultModel;
  if (provider === "codex") {
    return normalizeCodexModelId(resolved, PROVIDER_CONFIG.codex.runtimeDefaultModel);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// Chat request building
// ---------------------------------------------------------------------------

export interface ChatRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export interface ChatRequestError {
  error: string;
  status: number;
  /**
   * Which of the two 401s this is. Callers used to tell them apart by status
   * code, which cannot work: a missing credential and a rejected one both
   * answer 401, so "no key at all" was being reported to the writer as
   * "Provider not authenticated" and the label route's graceful-degradation
   * path (keyed on 400) was unreachable.
   *
   *   "no-key"      nothing was supplied. The fix is to add a key or sign in.
   *   "unauthenticated"  something was supplied and the provider refused it.
   */
  reason: "no-key" | "unauthenticated";
}

export interface BuildChatOptions {
  provider: AIProvider;
  model: string;
  prompt: string;
  apiKey?: string | null;
  codexToken?: string;
  stream: boolean;
  /** Optional system prompt (Brand Voice context). Emitted in true system position per protocol. */
  system?: string;
  /** Called directly from a browser/webview (Tauri prod) — affects CORS headers. */
  browserDirect?: boolean;
  /** Cap output tokens — used by credential-validation probes (a "ping" call). */
  maxTokens?: number;
}

function buildApiKeyHeaders(provider: AIProvider, key: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  // OpenRouter historically also accepts the key via x-api-key.
  if (provider === "openrouter") headers["x-api-key"] = key;
  return headers;
}

/**
 * Build a provider-specific chat request, or a `ChatRequestError` when a
 * required credential is missing.
 */
export function buildChatRequest(opts: BuildChatOptions): ChatRequest | ChatRequestError {
  const { provider, model, prompt, stream, browserDirect } = opts;
  const system = opts.system?.trim() ? opts.system : "";
  const config = PROVIDER_CONFIG[provider];

  // openai-chat & ollama: prepend a system message only when non-empty, so the
  // no-voice request body stays byte-identical to before this feature.
  const chatMessages = system
    ? [{ role: "system", content: system }, { role: "user", content: prompt }]
    : [{ role: "user", content: prompt }];

  switch (config.protocol) {
    case "ollama-chat":
      return {
        url: config.chatEndpoint,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages: chatMessages, stream }),
      };

    case "openai-responses": {
      // "unauthenticated", not "no-key": Codex is an OAuth connection, and a
      // missing token means the sign-in lapsed and can be renewed, which is
      // worth telling the writer about. A never-configured API key is not.
      if (!opts.codexToken) return { error: "Codex not authenticated", status: 401, reason: "unauthenticated" };
      return {
        url: config.chatEndpoint,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...buildCodexHeaders(opts.codexToken),
        },
        // Codex Responses API always streams server-side; we read it as SSE.
        body: JSON.stringify(buildCodexResponsesBody(model, prompt, system)),
      };
    }

    case "anthropic-messages": {
      const key = normalizeApiKey(opts.apiKey ?? undefined);
      if (!key) return { error: "No API key configured", status: 401, reason: "no-key" };
      return {
        url: config.chatEndpoint,
        headers: buildAnthropicHeaders(key, browserDirect),
        body: JSON.stringify(buildAnthropicBody(model, prompt, config.maxTokens ?? 4096, stream, system)),
      };
    }

    case "openai-chat":
    default: {
      const key = normalizeApiKey(opts.apiKey ?? undefined);
      if (!key) return { error: "No API key configured", status: 401, reason: "no-key" };
      return {
        url: config.chatEndpoint,
        headers: buildApiKeyHeaders(provider, key),
        body: JSON.stringify({
          model,
          messages: chatMessages,
          stream,
          ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
        }),
      };
    }
  }
}

export function isChatRequestError(value: ChatRequest | ChatRequestError): value is ChatRequestError {
  return "error" in value;
}

// ---------------------------------------------------------------------------
// Streaming — uniform SSE output ( {content} chunks, then {done, usage} )
// ---------------------------------------------------------------------------

function sseData(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

function transformOpenAIChatStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

  const buildDone = (): Record<string, unknown> => {
    const done: Record<string, unknown> = { done: true };
    if (lastUsage) {
      done.usage = {
        promptTokens: lastUsage.prompt_tokens,
        completionTokens: lastUsage.completion_tokens,
        totalTokens: lastUsage.total_tokens,
      };
    }
    return done;
  };

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":") || !trimmed.startsWith("data: ")) continue;
            const payload = trimmed.slice(6);
            if (payload === "[DONE]") {
              controller.enqueue(encoder.encode(sseData(buildDone())));
              continue;
            }
            try {
              const parsed = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
                usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
              };
              if (parsed.usage) lastUsage = parsed.usage;
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) controller.enqueue(encoder.encode(sseData({ content })));
            } catch {
              // skip malformed chunks
            }
          }
        }
        controller.enqueue(encoder.encode(sseData(buildDone())));
      } catch (err) {
        controller.enqueue(encoder.encode(sseData({ error: asErrorMessage(err), done: true })));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

function transformOllamaStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const parsed = JSON.parse(trimmed) as {
                message?: { content?: string };
                done?: boolean;
                prompt_eval_count?: number;
                eval_count?: number;
              };
              if (parsed.message?.content) {
                controller.enqueue(encoder.encode(sseData({ content: parsed.message.content })));
              }
              if (parsed.done) {
                const done: Record<string, unknown> = { done: true };
                if (parsed.prompt_eval_count !== undefined || parsed.eval_count !== undefined) {
                  done.usage = {
                    promptTokens: parsed.prompt_eval_count,
                    completionTokens: parsed.eval_count,
                    totalTokens: (parsed.prompt_eval_count ?? 0) + (parsed.eval_count ?? 0),
                  };
                }
                controller.enqueue(encoder.encode(sseData(done)));
              }
            } catch {
              // skip malformed lines
            }
          }
        }
        controller.enqueue(encoder.encode(sseData({ done: true })));
      } catch (err) {
        controller.enqueue(encoder.encode(sseData({ error: asErrorMessage(err), done: true })));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

function transformCodexStream(upstream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";
          for (const event of events) {
            let eventType = "";
            let dataStr = "";
            for (const line of event.split("\n")) {
              if (line.startsWith("event: ")) eventType = line.slice(7).trim();
              if (line.startsWith("data: ")) dataStr = line.slice(6);
            }
            if (eventType === "response.output_text.delta" && dataStr) {
              try {
                const parsed = JSON.parse(dataStr) as { delta?: string };
                if (parsed.delta) controller.enqueue(encoder.encode(sseData({ content: parsed.delta })));
              } catch {
                // skip
              }
            }
            if (eventType === "response.completed") {
              const done: Record<string, unknown> = { done: true };
              if (dataStr) {
                try {
                  const parsed = JSON.parse(dataStr) as {
                    response?: { usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number } };
                  };
                  const usage = parsed.response?.usage;
                  if (usage) {
                    done.usage = {
                      promptTokens: usage.input_tokens,
                      completionTokens: usage.output_tokens,
                      totalTokens: usage.total_tokens,
                    };
                  }
                } catch {
                  // skip
                }
              }
              controller.enqueue(encoder.encode(sseData(done)));
            }
          }
        }
        controller.enqueue(encoder.encode(sseData({ done: true })));
      } catch (err) {
        controller.enqueue(encoder.encode(sseData({ error: asErrorMessage(err), done: true })));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

/** Transform an upstream provider stream into the app's uniform SSE format. */
export function transformStream(
  provider: AIProvider,
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  switch (getProtocol(provider)) {
    case "ollama-chat":
      return transformOllamaStream(upstream);
    case "openai-responses":
      return transformCodexStream(upstream);
    case "anthropic-messages":
      return transformAnthropicStream(upstream);
    case "openai-chat":
    default:
      return transformOpenAIChatStream(upstream);
  }
}

// ---------------------------------------------------------------------------
// Non-streaming parse + error extraction
// ---------------------------------------------------------------------------

export interface CompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
}

export interface CompletionResult {
  content: string;
  modelUsed?: string;
  usage: CompletionUsage;
}

function truncateText(text: string, maxLen = 300): string {
  const normalized = text.trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function extractJsonError(raw: string, contentType: string | null): string {
  const isJson = (contentType || "").includes("application/json") || raw.trim().startsWith("{");
  if (isJson) {
    try {
      const data = JSON.parse(raw) as {
        error?: string | { message?: string; type?: string; code?: string; param?: string };
        message?: string;
        detail?: string;
      };
      if (typeof data.error === "string") return truncateText(data.error);
      if (data.error && typeof data.error === "object") {
        const details = [data.error.message, data.error.type, data.error.code, data.error.param].filter(Boolean);
        if (details.length > 0) return truncateText(details.join(" | "));
      }
      if (typeof data.message === "string") return truncateText(data.message);
      if (typeof data.detail === "string") return truncateText(data.detail);
    } catch {
      // fall through
    }
  }
  return raw ? truncateText(raw) : "Upstream request failed";
}

/** Extract a human-readable error message from a failed upstream response body. */
export function extractProviderError(provider: AIProvider, raw: string, contentType: string | null): string {
  switch (getProtocol(provider)) {
    case "openai-responses": {
      const parsed = parseCodexResponseBody(raw, contentType);
      return extractCodexErrorMessage(parsed) || truncateText(raw) || "Codex request failed";
    }
    case "anthropic-messages":
      return extractAnthropicError(raw) || truncateText(raw) || "Anthropic request failed";
    case "ollama-chat":
    case "openai-chat":
    default:
      return extractJsonError(raw, contentType);
  }
}

/** Parse a successful non-streaming completion body. */
export function parseCompletion(
  provider: AIProvider,
  raw: string,
  contentType: string | null,
  fallbackModel: string,
): CompletionResult {
  switch (getProtocol(provider)) {
    case "ollama-chat": {
      const data = JSON.parse(raw) as {
        message?: { content?: string };
        model?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const content = data.message?.content?.trim() ?? "";
      return {
        content,
        modelUsed: data.model || fallbackModel,
        usage: {
          promptTokens: data.prompt_eval_count,
          completionTokens: data.eval_count,
          totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
        },
      };
    }
    case "openai-responses": {
      const parsed = parseCodexResponseBody(raw, contentType);
      const usage = extractCodexResponseUsage(parsed);
      return {
        content: extractCodexResponseText(parsed),
        modelUsed: extractCodexResponseModel(parsed) || fallbackModel,
        usage,
      };
    }
    case "anthropic-messages": {
      const parsed = parseAnthropicCompletion(raw);
      return { content: parsed.content, modelUsed: parsed.modelUsed || fallbackModel, usage: parsed.usage };
    }
    case "openai-chat":
    default: {
      const data = JSON.parse(raw) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
        model?: string;
      };
      return {
        content: data.choices?.[0]?.message?.content?.trim() ?? "",
        modelUsed: data.model || fallbackModel,
        usage: {
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
          totalTokens: data.usage?.total_tokens,
          cost: data.usage?.cost,
        },
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Model-list discovery
// ---------------------------------------------------------------------------

export interface ModelsRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Build a request to list a provider's models, or null when the provider has
 * no list endpoint (use `getStaticModels`) or is missing a required credential.
 */
export function buildModelsRequest(
  provider: AIProvider,
  auth: { apiKey?: string | null; codexToken?: string },
): ModelsRequest | null {
  const config = PROVIDER_CONFIG[provider];
  if (!config.modelsEndpoint) return null;

  switch (config.protocol) {
    case "ollama-chat":
      return { url: config.modelsEndpoint, headers: {} };
    case "openai-responses": {
      if (!auth.codexToken) return null;
      return { url: config.modelsEndpoint, headers: buildCodexHeaders(auth.codexToken) };
    }
    case "anthropic-messages": {
      const key = normalizeApiKey(auth.apiKey ?? undefined);
      if (!key) return null;
      return { url: config.modelsEndpoint, headers: buildAnthropicHeaders(key, true) };
    }
    case "openai-chat":
    default: {
      const key = normalizeApiKey(auth.apiKey ?? undefined);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (key) {
        headers.Authorization = `Bearer ${key}`;
        if (provider === "openrouter") headers["x-api-key"] = key;
      }
      return { url: config.modelsEndpoint, headers };
    }
  }
}

export function getStaticModels(provider: AIProvider): ProviderModel[] | undefined {
  return PROVIDER_CONFIG[provider].staticModels;
}

interface OllamaModelEntry { name: string; model: string }
interface CodexModelEntry {
  slug?: string;
  display_name?: string;
  visibility?: string;
  id?: string;
  model_id?: string;
  model_slug?: string;
  name?: string;
}

/** Parse a provider's models-list response into the app's uniform shape. */
export function parseModels(provider: AIProvider, raw: string): ProviderModel[] {
  switch (getProtocol(provider)) {
    case "ollama-chat": {
      const data = JSON.parse(raw) as { models?: OllamaModelEntry[] };
      return (data.models ?? [])
        .map((m) => ({ id: m.name, name: m.name.replace(":latest", ""), provider: "local" }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    case "openai-responses": {
      const data = JSON.parse(raw) as {
        models?: CodexModelEntry[] | Record<string, CodexModelEntry>;
        items?: CodexModelEntry[];
      };
      const rawModels: CodexModelEntry[] = Array.isArray(data.models)
        ? data.models
        : data.models && typeof data.models === "object"
          ? Object.values(data.models)
          : Array.isArray(data.items)
            ? data.items
            : [];
      const seen = new Set<string>();
      return rawModels
        .map((m) => ({
          id: m.slug || m.model_slug || m.model_id || m.id || "",
          name: m.display_name || m.name || m.slug || m.id || "",
          provider: "codex",
          visibility: m.visibility,
        }))
        .filter((m) => {
          // Drop non-user-facing entries: the backend marks internal pseudo-models
          // (e.g. codex-auto-review) as "hide"/"hidden" rather than "list".
          const hidden = m.visibility === "hidden" || m.visibility === "hide";
          if (!m.id || hidden || seen.has(m.id)) return false;
          seen.add(m.id);
          return true;
        })
        .map(({ id, name, provider: p }) => ({ id, name, provider: p }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    case "anthropic-messages":
      return parseAnthropicModels(raw);
    case "openai-chat":
    default: {
      const data = JSON.parse(raw) as { data?: Array<{ id: string; name?: string }> };
      return (data.data ?? [])
        .map((m) => ({ id: m.id, name: m.name || m.id, provider: m.id.includes("/") ? m.id.split("/")[0] : provider }))
        .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
    }
  }
}
