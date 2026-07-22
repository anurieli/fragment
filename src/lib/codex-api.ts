const CODEX_API_BASE = "https://chatgpt.com/backend-api/codex";

// The backend gates the model list by client version: an old version only
// sees the models that existed when it shipped. Keep this tracking the
// latest stable @openai/codex release (`npm view @openai/codex version`).
const CODEX_CLIENT_VERSION = "0.143.0";

export const CODEX_MODELS_URL = `${CODEX_API_BASE}/models?client_version=${CODEX_CLIENT_VERSION}`;
export const CODEX_RESPONSES_URL = `${CODEX_API_BASE}/responses`;

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

function safeJsonParse(raw: string): unknown | null {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function decodeBase64Url(str: string): string {
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function normalizeBearerToken(rawToken: string): string {
  let token = rawToken.trim();
  if (
    (token.startsWith("\"") && token.endsWith("\""))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    token = token.slice(1, -1).trim();
  }
  if (/^bearer\s+/i.test(token)) {
    token = token.replace(/^bearer\s+/i, "").trim();
  }
  return token;
}

export function extractCodexAccountId(jwt: string): string | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(
      decodeBase64Url(parts[1]),
    ) as Record<string, unknown>;
    const nestedAuth = asObject(payload["https://api.openai.com/auth"]);
    const nestedAccount = nestedAuth?.chatgpt_account_id;

    if (typeof payload.chatgpt_account_id === "string") return payload.chatgpt_account_id;
    if (typeof nestedAccount === "string") return nestedAccount;
    if (typeof payload.organization_id === "string") return payload.organization_id;

    return null;
  } catch {
    return null;
  }
}

export interface CodexIdentity {
  /** OIDC subject — the stable per-USER id. Primary key for a user account. */
  sub: string;
  email: string | null;
  /**
   * ChatGPT account id. Personal plans: one account per user. Team/Enterprise:
   * shared across teammates — i.e. a workspace/tenant hint, NOT a user id.
   */
  accountId: string | null;
}

/**
 * Decode the identity claims from a Codex JWT (the OIDC `id_token`, or the
 * access token as a fallback — both are decodable JWTs carrying these claims).
 *
 * Signature is NOT verified here; this is claim extraction only. Server-side
 * session minting must verify against OpenAI's JWKS before trusting `sub`.
 */
export function extractCodexIdentity(jwt: string): CodexIdentity | null {
  try {
    const parts = jwt.split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return null;
    const email = typeof payload.email === "string" ? payload.email : null;
    return { sub, email, accountId: extractCodexAccountId(jwt) };
  } catch {
    return null;
  }
}

export function buildCodexHeaders(token: string): Record<string, string> {
  const normalizedToken = normalizeBearerToken(token);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${normalizedToken}`,
  };

  const accountId = extractCodexAccountId(normalizedToken);
  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  return headers;
}

export function buildCodexResponsesBody(model: string, prompt: string, instructions?: string): Record<string, unknown> {
  return {
    model,
    instructions: instructions?.trim() ? instructions : "",
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    store: false,
    stream: true,
    include: [],
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt,
          },
        ],
      },
    ],
  };
}

export function extractCodexCompletedPayloadFromSse(raw: string): unknown | null {
  const chunks = raw.split(/\r?\n\r?\n/);
  let fallbackPayload: unknown | null = null;
  let completedPayload: unknown | null = null;
  // With `store: false` the backend's response.completed event carries an
  // EMPTY `response.output` array — the text exists only in the per-item SSE
  // events. Collect those while scanning so it can be grafted back on below.
  const doneItems: unknown[] = [];
  const doneTexts: string[] = [];
  let deltaText = "";

  for (const chunk of chunks) {
    const lines = chunk
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;

    let eventName = "";
    const dataLines: string[] = [];

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trim());
      }
    }

    if (dataLines.length === 0) continue;
    const payloadText = dataLines.join("\n").trim();
    if (!payloadText || payloadText === "[DONE]") continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadText) as unknown;
    } catch {
      continue;
    }
    if (fallbackPayload === null) fallbackPayload = parsed;

    // Some proxies strip `event:` lines; the payload's own `type` is equivalent.
    const obj = asObject(parsed);
    const eventType = eventName || (typeof obj?.type === "string" ? obj.type : "");

    if (eventType === "response.completed") {
      completedPayload = parsed;
    } else if (eventType === "response.output_item.done") {
      const item = asObject(obj?.item);
      if (item) doneItems.push(item);
    } else if (eventType === "response.output_text.done") {
      if (typeof obj?.text === "string" && obj.text) doneTexts.push(obj.text);
    } else if (eventType === "response.output_text.delta") {
      if (typeof obj?.delta === "string") deltaText += obj.delta;
    }
  }

  const payload = completedPayload ?? fallbackPayload;
  if (payload === null) return null;

  // Graft collected output back onto the payload when its own output carries
  // no text, so extractCodexResponseText finds the message content.
  if (!extractCodexResponseText(payload)) {
    const root = asObject(asObject(payload)?.response) || asObject(payload);
    if (root) {
      if (doneItems.length > 0) {
        root.output = doneItems;
      } else {
        const text = doneTexts.join("\n") || deltaText;
        if (text) root.output_text = text;
      }
    }
  }
  return payload;
}

export function parseCodexResponseBody(
  raw: string,
  contentType?: string | null,
): unknown {
  const normalizedContentType = (contentType || "").toLowerCase();
  if (normalizedContentType.includes("text/event-stream") || raw.includes("event:")) {
    return extractCodexCompletedPayloadFromSse(raw) ?? safeJsonParse(raw) ?? {};
  }
  return safeJsonParse(raw) ?? extractCodexCompletedPayloadFromSse(raw) ?? {};
}

export function extractCodexErrorMessage(payload: unknown): string | undefined {
  const rootCandidate = asObject(payload);
  const root = asObject(rootCandidate?.response) || rootCandidate;
  if (!root) return undefined;

  if (typeof root.detail === "string" && root.detail.trim()) return root.detail.trim();
  if (typeof root.message === "string" && root.message.trim()) return root.message.trim();

  if (typeof root.error === "string" && root.error.trim()) return root.error.trim();
  const errorObj = asObject(root.error);
  if (errorObj) {
    const parts = [
      typeof errorObj.message === "string" ? errorObj.message : "",
      typeof errorObj.type === "string" ? errorObj.type : "",
      typeof errorObj.code === "string" ? errorObj.code : "",
      typeof errorObj.param === "string" ? errorObj.param : "",
    ].filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
  }

  return undefined;
}

export function normalizeCodexModelId(rawModel: string, fallback = "gpt-4o-mini"): string {
  const candidate = rawModel.trim() || fallback;
  if (!candidate.includes("/")) return candidate;
  const slug = candidate.split("/").pop()?.trim();
  return slug || fallback;
}

export function extractCodexResponseText(payload: unknown): string {
  const rootCandidate = asObject(payload);
  const root = asObject(rootCandidate?.response) || rootCandidate;
  if (!root) return "";

  if (typeof root.output_text === "string") {
    return root.output_text.trim();
  }

  const textParts: string[] = [];
  const outputItems = asArray(root.output);

  for (const itemValue of outputItems) {
    const item = asObject(itemValue);
    if (!item) continue;
    if (typeof item.text === "string" && item.text.trim()) {
      textParts.push(item.text.trim());
    }

    const contentItems = asArray(item.content);
    for (const contentValue of contentItems) {
      const content = asObject(contentValue);
      if (!content) continue;
      const contentType = typeof content.type === "string" ? content.type : "";
      if (contentType !== "output_text" && contentType !== "text") continue;
      if (typeof content.text === "string" && content.text.trim()) {
        textParts.push(content.text.trim());
      }
    }
  }

  return textParts.join("\n").trim();
}

export function extractCodexResponseModel(payload: unknown): string | undefined {
  const rootCandidate = asObject(payload);
  const root = asObject(rootCandidate?.response) || rootCandidate;
  return root && typeof root.model === "string" ? root.model : undefined;
}

export function extractCodexResponseUsage(payload: unknown): {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
} {
  const rootCandidate = asObject(payload);
  const root = asObject(rootCandidate?.response) || rootCandidate;
  const usage = asObject(root?.usage);
  if (!usage) return {};

  return {
    promptTokens: asNumber(usage.input_tokens) ?? asNumber(usage.prompt_tokens),
    completionTokens: asNumber(usage.output_tokens) ?? asNumber(usage.completion_tokens),
    totalTokens: asNumber(usage.total_tokens),
  };
}
