/**
 * Client-side direct API calls for Tauri (static build) environments.
 *
 * When running inside a Tauri webview the Next.js API routes (/api/*) don't
 * exist because the build uses `output: "export"` (static HTML). This module
 * detects that situation and calls the provider directly from the browser
 * instead, via the shared provider runtime. In non-Tauri (dev server) mode
 * every function falls through to the regular fetch("/api/...") path so
 * behaviour is unchanged.
 *
 * Every exported function returns a standard Response so callers (hooks,
 * components) don't need separate code paths.
 */

import {
  isAIProvider,
  isApiKeyProvider,
  normalizeApiKey,
  resolveModel,
  buildChatRequest,
  isChatRequestError,
  transformStream,
  parseCompletion,
  extractProviderError,
  buildModelsRequest,
  getStaticModels,
  parseModels,
  type AIProvider,
} from "./ai/provider-runtime";
import {
  CODEX_CLIENT_ID,
  CODEX_DEVICE_USERCODE_URL,
  CODEX_DEVICE_TOKEN_URL,
  CODEX_TOKEN_URL,
  CODEX_DEVICE_AUTH_REDIRECT,
} from "./codex-auth";
import { codexFetch } from "./platform-fetch";

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

/** True when running inside a Tauri webview (static export, no Next.js server). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Open a URL in the user's default system browser.
 * In Tauri: uses the opener plugin.  In browser: falls back to window.open.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      // Opener plugin not available — fall through to window.open
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SSE_HEADERS_CLIENT = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
} as const;

function sseErrorClient(message: string, status = 500): Response {
  return new Response(`data: ${JSON.stringify({ error: message, done: true })}\n\n`, {
    status,
    headers: SSE_HEADERS_CLIENT,
  });
}

// ---------------------------------------------------------------------------
// Direct chat completion (Tauri production builds)
// ---------------------------------------------------------------------------

interface ChatParams {
  prompt: string;
  requestedModel: string;
  provider: AIProvider;
  apiKey?: string;
  codexToken?: string;
  system?: string;
  signal?: AbortSignal;
}

async function directChat(params: ChatParams): Promise<Response> {
  const { prompt, provider, apiKey, codexToken, system, signal } = params;
  const model = resolveModel(provider, params.requestedModel);
  const startTime = Date.now();

  const chatRequest = buildChatRequest({ provider, model, prompt, apiKey, codexToken, stream: false, system, browserDirect: true });
  if (isChatRequestError(chatRequest)) {
    return jsonResponse(
      {
        error: chatRequest.error,
        label: provider === "codex" ? "Codex not authenticated" : "AI labeling unavailable",
        content: "",
        _meta: { durationMs: Date.now() - startTime, statusCode: chatRequest.status, error: chatRequest.error, promptLength: prompt.length, responseLength: 0, modelRequested: params.requestedModel, modelUsed: model },
      },
      chatRequest.status,
    );
  }

  try {
    const res = await codexFetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body, signal });
    const durationMs = Date.now() - startTime;
    const rawBody = await res.text();

    if (!res.ok) {
      const upstreamError = extractProviderError(provider, rawBody, res.headers.get("content-type"));
      return jsonResponse(
        {
          error: `${provider} request failed`,
          label: `${provider} request failed`,
          content: "",
          _meta: { durationMs, statusCode: res.status, error: `${provider} request failed: ${upstreamError}`, promptLength: prompt.length, responseLength: 0, modelRequested: params.requestedModel, modelUsed: model },
        },
        res.status,
      );
    }

    const result = parseCompletion(provider, rawBody, res.headers.get("content-type"), model);
    return jsonResponse({
      content: result.content,
      label: result.content,
      _meta: {
        durationMs,
        statusCode: 200,
        promptLength: prompt.length,
        responseLength: result.content.length,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cost: result.usage.cost,
        modelRequested: params.requestedModel,
        modelUsed: result.modelUsed || model,
      },
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return jsonResponse(
      {
        error: `${provider} not reachable`,
        label: `${provider} not reachable`,
        content: "",
        _meta: { durationMs: Date.now() - startTime, statusCode: 503, error: `${provider} not reachable`, promptLength: prompt.length, responseLength: 0, modelRequested: params.requestedModel, modelUsed: model },
      },
      503,
    );
  }
}

/** Direct streaming chat for Tauri production builds — returns SSE Response. */
async function directChatStream(params: ChatParams): Promise<Response> {
  const { prompt, provider, apiKey, codexToken, system, signal } = params;
  const model = resolveModel(provider, params.requestedModel);

  const chatRequest = buildChatRequest({ provider, model, prompt, apiKey, codexToken, stream: true, system, browserDirect: true });
  if (isChatRequestError(chatRequest)) return sseErrorClient(chatRequest.error, chatRequest.status);

  try {
    const res = await codexFetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body, signal });
    if (!res.ok || !res.body) return sseErrorClient(`${provider} request failed`, res.status);
    return new Response(transformStream(provider, res.body), { headers: SSE_HEADERS_CLIENT });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    return sseErrorClient(`${provider} not reachable`, 503);
  }
}

// ---------------------------------------------------------------------------
// Prompt builders (mirror the template substitution in each route handler)
// ---------------------------------------------------------------------------

interface ProviderBodyBase {
  model?: string;
  provider?: unknown;
  apiKey?: string;
  codexToken?: string;
}

interface LabelBody extends ProviderBodyBase {
  snippetContent?: string;
  essayContent?: string;
  goal?: string;
  promptTemplate?: string;
}

function buildLabelPrompt(body: LabelBody): string {
  const goal = body.goal || "";
  const goalSuffix = goal ? ` with this goal: "${goal}"` : "";
  const essayContent = body.essayContent || "";
  const essayBlock = essayContent
    ? `Here is their full essay so far:\n---\n${essayContent}\n---\n\n`
    : "";
  return (body.promptTemplate || "")
    .replace("{goal}", goalSuffix)
    .replace("{essayContent}", essayBlock)
    .replace("{snippetContent}", body.snippetContent || "");
}

interface AnalyzeVoiceBody extends ProviderBodyBase {
  voiceName?: string;
  description?: string;
  samplesText?: string;
  promptTemplate?: string;
}

function buildAnalyzeVoicePrompt(body: AnalyzeVoiceBody): string {
  // Single-pass, function-replacer substitution — mirrors /api/analyze-voice:
  // avoids $-sequence mangling of raw sample text and placeholder collisions.
  const substitutions: Record<string, string> = {
    "{voiceName}": body.voiceName || "Untitled voice",
    "{description}": body.description || "(none provided)",
    "{samples}": body.samplesText || "(no samples provided)",
  };
  return (body.promptTemplate || "").replace(
    /\{voiceName\}|\{description\}|\{samples\}/g,
    (m) => substitutions[m] ?? m,
  );
}

interface ExtractBody extends ProviderBodyBase {
  source?: string;
  goal?: string;
  audience?: string;
  tone?: string;
  remember?: string;
  promptTemplate?: string;
}

function buildExtractPrompt(body: ExtractBody): string {
  // Single-pass, function-replacer substitution, mirroring /api/extract: the
  // source is raw draft content and may contain $-sequences or a literal
  // {source} of its own.
  const substitutions: Record<string, string> = {
    "{source}": body.source || "(nothing written in this idea yet)",
    "{goal}": body.goal || "No specific goal set",
    "{audience}": body.audience || "General audience",
    "{tone}": body.tone || "Match the source material",
    "{remember}": body.remember || "None",
  };
  return (body.promptTemplate || "").replace(
    /\{source\}|\{goal\}|\{audience\}|\{tone\}|\{remember\}/g,
    (m) => substitutions[m] ?? m,
  );
}

interface GenerateBody extends ProviderBodyBase {
  contextAbove?: string;
  contextBelow?: string;
  goal?: string;
  audience?: string;
  tone?: string;
  remember?: string;
  userInstruction?: string;
  promptTemplate?: string;
  voiceContext?: string;
}

function buildGeneratePrompt(body: GenerateBody): string {
  return (body.promptTemplate || "")
    .replace("{goal}", body.goal || "No specific goal set")
    .replace("{audience}", body.audience || "General audience")
    .replace("{tone}", body.tone || "Match the surrounding text")
    .replace("{remember}", body.remember || "None")
    .replace("{contextAbove}", body.contextAbove || "(beginning of document)")
    .replace("{contextBelow}", body.contextBelow || "(end of document)")
    .replace("{userInstruction}", body.userInstruction || "");
}

interface EditBody extends ProviderBodyBase {
  selectedText?: string;
  contextBefore?: string;
  contextAfter?: string;
  goal?: string;
  audience?: string;
  tone?: string;
  remember?: string;
  instruction?: string;
  promptTemplate?: string;
  voiceContext?: string;
}

function buildEditPrompt(body: EditBody): string {
  return (body.promptTemplate || "")
    .replace("{goal}", body.goal || "No specific goal set")
    .replace("{audience}", body.audience || "General audience")
    .replace("{tone}", body.tone || "Match the surrounding text")
    .replace("{remember}", body.remember || "None")
    .replace("{contextBefore}", body.contextBefore || "(beginning of document)")
    .replace("{contextAfter}", body.contextAfter || "(end of document)")
    .replace("{selectedText}", body.selectedText || "")
    .replace("{instruction}", body.instruction || "");
}

/**
 * In Tauri dev mode, when an api-key provider has no key in the request body,
 * try the Next.js dev server first — it can read the key from server env
 * (process.env.<PROVIDER>_API_KEY). Returns null when no fallback applies.
 */
async function tryDevServerFallback(
  path: string,
  provider: AIProvider,
  apiKey: string | undefined,
  bodyJson: string,
  signal?: AbortSignal,
): Promise<Response | null> {
  if (!isApiKeyProvider(provider) || normalizeApiKey(apiKey)) return null;
  try {
    return await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal,
    });
  } catch {
    return null; // Dev server not available (production build)
  }
}

// ---------------------------------------------------------------------------
// Exported route proxies
// ---------------------------------------------------------------------------

/** POST /api/label — Snip (snippet labeling) */
export async function postLabel(
  bodyJson: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  if (!isTauri()) {
    return fetch("/api/label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal: options?.signal,
    });
  }
  const body = JSON.parse(bodyJson) as LabelBody;
  if (!isAIProvider(body.provider)) {
    return jsonResponse(
      { label: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider", promptLength: 0, responseLength: 0 } },
      400,
    );
  }
  const fallback = await tryDevServerFallback("/api/label", body.provider, body.apiKey, bodyJson, options?.signal);
  if (fallback) return fallback;
  return directChat({
    prompt: buildLabelPrompt(body),
    requestedModel: body.model || "",
    provider: body.provider,
    apiKey: body.apiKey,
    codexToken: body.codexToken,
    signal: options?.signal,
  });
}

/** POST /api/analyze-voice — Brand Voice distillation (non-streaming) */
export async function postAnalyzeVoice(
  bodyJson: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  if (!isTauri()) {
    return fetch("/api/analyze-voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal: options?.signal,
    });
  }
  const body = JSON.parse(bodyJson) as AnalyzeVoiceBody;
  if (!isAIProvider(body.provider)) {
    return jsonResponse(
      { error: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } },
      400,
    );
  }
  const fallback = await tryDevServerFallback("/api/analyze-voice", body.provider, body.apiKey, bodyJson, options?.signal);
  if (fallback) return fallback;
  return directChat({
    prompt: buildAnalyzeVoicePrompt(body),
    requestedModel: body.model || "",
    provider: body.provider,
    apiKey: body.apiKey,
    codexToken: body.codexToken,
    signal: options?.signal,
  });
}

/** POST /api/extract — the idea extractor (non-streaming) */
export async function postExtract(
  bodyJson: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  if (!isTauri()) {
    return fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal: options?.signal,
    });
  }
  const body = JSON.parse(bodyJson) as ExtractBody;
  if (!isAIProvider(body.provider)) {
    return jsonResponse(
      { error: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } },
      400,
    );
  }
  const fallback = await tryDevServerFallback("/api/extract", body.provider, body.apiKey, bodyJson, options?.signal);
  if (fallback) return fallback;
  return directChat({
    prompt: buildExtractPrompt(body),
    requestedModel: body.model || "",
    provider: body.provider,
    apiKey: body.apiKey,
    codexToken: body.codexToken,
    signal: options?.signal,
  });
}

/** POST /api/generate — Flow (slash command generation, non-streaming) */
export async function postGenerate(
  bodyJson: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  if (!isTauri()) {
    return fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal: options?.signal,
    });
  }
  const body = JSON.parse(bodyJson) as GenerateBody;
  if (!isAIProvider(body.provider)) {
    return jsonResponse(
      { error: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } },
      400,
    );
  }
  const fallback = await tryDevServerFallback("/api/generate", body.provider, body.apiKey, bodyJson, options?.signal);
  if (fallback) return fallback;
  return directChat({
    prompt: buildGeneratePrompt(body),
    requestedModel: body.model || "",
    provider: body.provider,
    apiKey: body.apiKey,
    codexToken: body.codexToken,
    system: body.voiceContext,
    signal: options?.signal,
  });
}

/** POST /api/generate with stream:true — returns raw Response with SSE body */
export async function postGenerateStream(
  bodyJson: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  // Inject stream:true into the body
  const parsed = JSON.parse(bodyJson) as Record<string, unknown>;
  parsed.stream = true;
  const streamBody = JSON.stringify(parsed);

  if (!isTauri()) {
    return fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: streamBody,
      signal: options?.signal,
    });
  }

  // In Tauri mode, always try the Next.js dev server first — the API key
  // may only exist server-side in .env, not in the client settings store.
  try {
    return await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: streamBody,
      signal: options?.signal,
    });
  } catch {
    // Dev server not available (production build) — fall through to direct streaming
  }

  const body = parsed as unknown as GenerateBody;
  return directChatStream({
    prompt: buildGeneratePrompt(body),
    requestedModel: body.model || "",
    provider: body.provider as AIProvider,
    apiKey: body.apiKey,
    codexToken: body.codexToken,
    system: body.voiceContext,
    signal: options?.signal,
  });
}

/** POST /api/edit — Refine (inline editing) */
export async function postEdit(
  bodyJson: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  if (!isTauri()) {
    return fetch("/api/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
      signal: options?.signal,
    });
  }
  const body = JSON.parse(bodyJson) as EditBody;
  if (!isAIProvider(body.provider)) {
    return jsonResponse(
      { error: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } },
      400,
    );
  }
  const fallback = await tryDevServerFallback("/api/edit", body.provider, body.apiKey, bodyJson, options?.signal);
  if (fallback) return fallback;
  return directChat({
    prompt: buildEditPrompt(body),
    requestedModel: body.model || "",
    provider: body.provider,
    apiKey: body.apiKey,
    codexToken: body.codexToken,
    system: body.voiceContext,
    signal: options?.signal,
  });
}

// ---------------------------------------------------------------------------
// GET /api/models — Model list fetching
// ---------------------------------------------------------------------------

export async function getModels(
  provider: string,
  headers: Record<string, string>,
): Promise<Response> {
  if (!isTauri()) {
    return fetch(`/api/models?provider=${provider}`, { headers });
  }

  const startTime = Date.now();
  if (!isAIProvider(provider)) {
    return jsonResponse({ models: [], _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } }, 400);
  }

  const staticModels = getStaticModels(provider);
  if (staticModels) {
    return jsonResponse({ models: staticModels, _meta: { durationMs: Date.now() - startTime, statusCode: 200 } });
  }

  const modelsRequest = buildModelsRequest(provider, {
    apiKey: headers["x-api-key"],
    codexToken: headers["x-auth-token"],
  });
  if (!modelsRequest) {
    const error = provider === "codex" ? "Not authenticated with Codex" : "Missing API key";
    return jsonResponse({ models: [], error, _meta: { durationMs: Date.now() - startTime, statusCode: 401, error } });
  }

  try {
    const res = await codexFetch(modelsRequest.url, { headers: modelsRequest.headers });
    const durationMs = Date.now() - startTime;
    if (!res.ok) {
      return jsonResponse({ models: [], _meta: { durationMs, statusCode: res.status, error: `${provider} models fetch failed` } }, res.status);
    }
    const models = parseModels(provider, await res.text());
    return jsonResponse({ models, _meta: { durationMs, statusCode: 200 } });
  } catch {
    return jsonResponse({ models: [], error: `${provider} not reachable`, _meta: { durationMs: Date.now() - startTime, statusCode: 503, error: `${provider} not reachable` } });
  }
}

// ---------------------------------------------------------------------------
// Credential validation — "does this key/token actually work?"
// ---------------------------------------------------------------------------

export interface ValidateCredentialResult {
  ok: boolean;
  error?: string;
  /** True when the failure looks like a reach/network problem, not a rejected credential. */
  unreachable?: boolean;
}

/** Probe a static-list provider (no /models endpoint) with a minimal chat call. */
async function validateViaChatProbe(
  provider: AIProvider,
  apiKey: string | undefined,
): Promise<ValidateCredentialResult> {
  if (!isTauri()) {
    try {
      const res = await fetch("/api/validate-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, apiKey }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      return { ok: !!data.ok, error: data.error, unreachable: !data.ok && !data.error };
    } catch {
      return { ok: false, error: `Couldn't reach ${provider}.`, unreachable: true };
    }
  }

  // Tauri: no /api routes exist in the static export — probe the provider directly.
  const model = resolveModel(provider, "");
  const chatRequest = buildChatRequest({ provider, model, prompt: "ping", apiKey, stream: false, browserDirect: true, maxTokens: 1 });
  if (isChatRequestError(chatRequest)) {
    return { ok: false, error: chatRequest.error };
  }
  try {
    const res = await fetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: "That key was rejected." };
    return { ok: false, error: `Couldn't reach ${provider}.`, unreachable: true };
  } catch {
    return { ok: false, error: `Couldn't reach ${provider}.`, unreachable: true };
  }
}

/**
 * Validate a provider credential in both web and Tauri, before letting the
 * user through the connect gate / onboarding.
 *
 * List-endpoint providers (openrouter, openai, anthropic, ollama, codex) are
 * validated via the existing `getModels()` — it hits the real provider
 * endpoint with the user's key and surfaces a rejected (401/403) vs.
 * unreachable failure. Static-list providers (perplexity) have no list
 * endpoint that proves the key works, so they go through a minimal chat probe.
 */
export async function validateProviderCredential(input: {
  provider: AIProvider;
  apiKey?: string;
  codexToken?: string;
}): Promise<ValidateCredentialResult> {
  const { provider, apiKey, codexToken } = input;

  if (getStaticModels(provider)) {
    return validateViaChatProbe(provider, apiKey);
  }

  const headers: Record<string, string> = {};
  if (apiKey) headers["x-api-key"] = apiKey;
  if (codexToken) headers["x-auth-token"] = codexToken;

  const res = await getModels(provider, headers);
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: "That key was rejected." };
  }
  if (res.status === 503) {
    return { ok: false, error: `Couldn't reach ${provider}.`, unreachable: true };
  }

  // The models routes sometimes report a failure in the body with a 200
  // status (e.g. a caught network error) rather than the real HTTP code —
  // fall back to the envelope's own statusCode to catch those too.
  let data: { error?: string; _meta?: { statusCode?: number } } = {};
  try {
    data = (await res.clone().json()) as typeof data;
  } catch {
    // non-JSON body — treat as a plain ok/fail below
  }
  const effectiveStatus = data._meta?.statusCode ?? res.status;

  if (res.ok && !data.error) return { ok: true };
  if (effectiveStatus === 401 || effectiveStatus === 403) {
    return { ok: false, error: "That key was rejected." };
  }
  return { ok: false, error: data.error || `Couldn't reach ${provider}.`, unreachable: true };
}

// ---------------------------------------------------------------------------
// Codex OAuth device flow (POST /api/auth/codex/start & /token)
// Unchanged — preserves the hardened ChatGPT (Codex) session work.
// ---------------------------------------------------------------------------

/** POST /api/auth/codex/start — initiate device code flow */
export async function postCodexStart(): Promise<Response> {
  if (!isTauri()) {
    return fetch("/api/auth/codex/start", { method: "POST" });
  }
  try {
    const res = await fetch(CODEX_DEVICE_USERCODE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CODEX_CLIENT_ID }),
    });
    if (!res.ok) {
      const text = await res.text();
      return jsonResponse({ error: `Failed to start device auth: ${text}` }, res.status);
    }
    const data = (await res.json()) as Record<string, unknown>;
    return jsonResponse({
      deviceAuthId: data.device_auth_id,
      userCode: data.user_code || data.usercode,
      interval: parseInt(String(data.interval), 10) || 5,
    });
  } catch {
    return jsonResponse({ error: "Could not reach OpenAI auth server" }, 503);
  }
}

/** POST /api/auth/codex/token — poll device code / refresh token */
export async function postCodexToken(bodyJson: string): Promise<Response> {
  if (!isTauri()) {
    return fetch("/api/auth/codex/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyJson,
    });
  }
  const body = JSON.parse(bodyJson) as {
    deviceAuthId?: string;
    userCode?: string;
    refreshToken?: string;
  };

  // --- Token refresh flow ---
  if (body.refreshToken) {
    try {
      const res = await fetch(CODEX_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: CODEX_CLIENT_ID,
          grant_type: "refresh_token",
          refresh_token: body.refreshToken,
          scope: "openid profile email",
        }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        return jsonResponse(
          { error: (data.error_description as string) || (data.error as string) || "Refresh failed" },
          res.status,
        );
      }
      return jsonResponse({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
      });
    } catch {
      return jsonResponse({ error: "Could not reach auth server" }, 503);
    }
  }

  // --- Device code poll flow ---
  if (!body.deviceAuthId || !body.userCode) {
    return jsonResponse({ error: "Missing deviceAuthId or userCode" }, 400);
  }
  try {
    const pollRes = await fetch(CODEX_DEVICE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_auth_id: body.deviceAuthId,
        user_code: body.userCode,
      }),
    });
    if (pollRes.status === 403 || pollRes.status === 404) {
      return jsonResponse({ status: "pending" });
    }
    if (!pollRes.ok) {
      return jsonResponse({ error: "Device auth failed", status: "error" }, pollRes.status);
    }
    const pollData = (await pollRes.json()) as {
      authorization_code?: string;
      code_verifier?: string;
    };
    if (!pollData.authorization_code || !pollData.code_verifier) {
      return jsonResponse({ error: "Unexpected response from device auth", status: "error" }, 500);
    }

    const tokenRes = await fetch(CODEX_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: pollData.authorization_code,
        redirect_uri: CODEX_DEVICE_AUTH_REDIRECT,
        client_id: CODEX_CLIENT_ID,
        code_verifier: pollData.code_verifier,
      }).toString(),
    });
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok) {
      return jsonResponse(
        { error: (tokenData.error_description as string) || "Token exchange failed", status: "error" },
        tokenRes.status,
      );
    }
    return jsonResponse({
      status: "success",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
    });
  } catch {
    return jsonResponse({ error: "Could not reach auth server", status: "error" }, 503);
  }
}
