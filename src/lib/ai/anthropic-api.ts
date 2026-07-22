/**
 * Anthropic Messages API adapter.
 *
 * Anthropic does not speak the OpenAI chat-completions wire format, so it gets
 * a dedicated adapter (mirroring codex-api.ts). Pure module — no React, no
 * next/server — so it can be imported by both the route handlers and the
 * Tauri client mirror (ai-client.ts).
 *
 * Docs: https://docs.anthropic.com/en/api/messages
 */

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
export const ANTHROPIC_MESSAGES_URL = `${ANTHROPIC_API_BASE}/messages`;
export const ANTHROPIC_MODELS_URL = `${ANTHROPIC_API_BASE}/models?limit=1000`;
const ANTHROPIC_VERSION = "2023-06-01";

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/**
 * Build request headers. When called directly from a browser/webview (Tauri
 * production), Anthropic requires an explicit opt-in header or it rejects the
 * cross-origin request.
 */
export function buildAnthropicHeaders(
  apiKey: string,
  browserDirect = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "Content-Type": "application/json",
  };
  if (browserDirect) {
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  return headers;
}

/** Build the Messages request body. `max_tokens` is required by Anthropic. */
export function buildAnthropicBody(
  model: string,
  prompt: string,
  maxTokens: number,
  stream: boolean,
  system?: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
    stream,
  };
  if (system && system.trim()) body.system = system;
  return body;
}

export interface AnthropicUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** Parse a non-streaming Messages response. */
export function parseAnthropicCompletion(raw: string): {
  content: string;
  modelUsed?: string;
  usage: AnthropicUsage;
} {
  const root = asObject(safeJsonParse(raw));
  if (!root) return { content: "", usage: {} };

  const textParts: string[] = [];
  for (const block of asArray(root.content)) {
    const b = asObject(block);
    if (!b) continue;
    if ((b.type === "text" || typeof b.text === "string") && typeof b.text === "string") {
      textParts.push(b.text);
    }
  }

  const usageObj = asObject(root.usage);
  const promptTokens = asNumber(usageObj?.input_tokens);
  const completionTokens = asNumber(usageObj?.output_tokens);
  const totalTokens =
    promptTokens !== undefined || completionTokens !== undefined
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : undefined;

  return {
    content: textParts.join("").trim(),
    modelUsed: typeof root.model === "string" ? root.model : undefined,
    usage: { promptTokens, completionTokens, totalTokens },
  };
}

/** Extract a human-readable error message from an Anthropic error body. */
export function extractAnthropicError(raw: string): string | undefined {
  const root = asObject(safeJsonParse(raw));
  if (!root) return undefined;
  const error = asObject(root.error);
  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim();
  }
  if (typeof root.message === "string" && root.message.trim()) return root.message.trim();
  return undefined;
}

/**
 * Transform an Anthropic streaming response into the app's uniform SSE format
 * (`data: {content}` chunks, then `data: {done, usage}`).
 *
 * Anthropic emits events separated by \n\n. We key off the `type` field in the
 * data payload: `content_block_delta` carries `delta.text`; `message_start`
 * carries input_tokens; `message_delta` carries the final output_tokens.
 */
export function transformAnthropicStream(
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffer = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  const sse = (obj: Record<string, unknown>) => encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);

  const buildDone = (): Record<string, unknown> => {
    const done: Record<string, unknown> = { done: true };
    if (inputTokens !== undefined || outputTokens !== undefined) {
      done.usage = {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
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

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          for (const event of events) {
            let dataStr = "";
            for (const line of event.split("\n")) {
              if (line.startsWith("data:")) dataStr = line.slice(5).trim();
            }
            if (!dataStr || dataStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(dataStr) as {
                type?: string;
                delta?: { text?: string };
                message?: { usage?: { input_tokens?: number; output_tokens?: number } };
                usage?: { output_tokens?: number };
              };
              if (parsed.type === "content_block_delta" && parsed.delta?.text) {
                controller.enqueue(sse({ content: parsed.delta.text }));
              } else if (parsed.type === "message_start") {
                const u = parsed.message?.usage;
                if (u?.input_tokens !== undefined) inputTokens = u.input_tokens;
                if (u?.output_tokens !== undefined) outputTokens = u.output_tokens;
              } else if (parsed.type === "message_delta") {
                if (parsed.usage?.output_tokens !== undefined) outputTokens = parsed.usage.output_tokens;
              }
            } catch {
              // Skip malformed events
            }
          }
        }
        controller.enqueue(sse(buildDone()));
      } catch (err) {
        controller.enqueue(sse({ error: err instanceof Error ? err.message : String(err), done: true }));
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

interface AnthropicModelEntry {
  id?: string;
  display_name?: string;
}

/** Parse the Anthropic /v1/models list response. */
export function parseAnthropicModels(raw: string): { id: string; name: string; provider: string }[] {
  const root = asObject(safeJsonParse(raw));
  const data = root ? asArray(root.data) : [];
  const seen = new Set<string>();
  return data
    .map((m) => m as AnthropicModelEntry)
    .map((m) => ({ id: m.id || "", name: m.display_name || m.id || "", provider: "anthropic" }))
    .filter((m) => {
      if (!m.id || seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
