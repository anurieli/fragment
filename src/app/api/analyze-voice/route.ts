import { NextRequest, NextResponse } from "next/server";
import {
  AI_RATE_LIMIT,
  MAX_PROMPT_CHARS,
  bodyTooLarge,
  checkRateLimit,
  getClientIp,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/api-guards";
import { createApiLogFieldSnapshot, createApiLogRequestSnapshot } from "@/lib/api-log-details";
import {
  isAIProvider,
  resolveModel,
  getServerEnvKey,
  normalizeApiKey,
  buildChatRequest,
  isChatRequestError,
  parseCompletion,
  extractProviderError,
} from "@/lib/ai/provider-runtime";

function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function asErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

function logAnalyze(
  level: "info" | "warn" | "error",
  stage: string,
  payload: Record<string, unknown>,
): void {
  const message = `[api/analyze-voice] ${stage}`;
  if (level === "error") return void console.error(message, payload);
  if (level === "warn") return void console.warn(message, payload);
  console.info(message, payload);
}

/**
 * Voice analysis (distillation). Returns the raw model completion as `content`;
 * JSON parsing into a VoiceProfile happens client-side (shared parseVoiceProfile)
 * so web and Tauri behave identically.
 */
export async function POST(req: NextRequest) {
  const rate = checkRateLimit(`analyze-voice:${getClientIp(req)}`, AI_RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfter);
  if (bodyTooLarge(req)) return payloadTooLargeResponse();

  const body = await req.json() as {
    voiceName?: string;
    description?: string;
    samplesText?: string;
    promptTemplate?: string;
    model?: string;
    provider?: unknown;
    apiKey?: string;
    codexToken?: string;
  };
  const provider = body.provider;
  if (!isAIProvider(provider)) {
    return NextResponse.json(
      { error: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } },
      { status: 400 },
    );
  }

  const voiceName = body.voiceName || "";
  const description = body.description || "";
  const samplesText = body.samplesText || "";
  const promptTemplate = body.promptTemplate || "";
  const requestedModel = body.model || "";
  const codexToken = body.codexToken;
  const apiKey = body.apiKey || getServerEnvKey(provider);

  // Single-pass substitution with a function replacer. Two reasons vs. chained
  // string .replace(): (1) a string replacement value special-cases $$, $&, $`,
  // $' — samplesText/description are raw document content (LaTeX/markdown math,
  // financial writing) that can contain `$$` and would be silently mangled;
  // (2) one pass means an injected `{samples}` inside description can't hijack
  // the real placeholder.
  const substitutions: Record<string, string> = {
    "{voiceName}": voiceName || "Untitled voice",
    "{description}": description || "(none provided)",
    "{samples}": samplesText || "(no samples provided)",
  };
  const prompt = (promptTemplate || "").replace(
    /\{voiceName\}|\{description\}|\{samples\}/g,
    (m) => substitutions[m] ?? m,
  );

  if (prompt.length > MAX_PROMPT_CHARS) return payloadTooLargeResponse();

  const startTime = Date.now();
  const requestId = createRequestId();
  const modelToRun = resolveModel(provider, requestedModel);
  const requestSnapshot = createApiLogRequestSnapshot({
    requestId,
    modelRequested: requestedModel,
    promptTemplate,
    fields: [
      createApiLogFieldSnapshot("voiceName", voiceName, { sampleMode: "full", maxChars: 120 }),
      createApiLogFieldSnapshot("description", description, { sampleMode: "head-tail", maxChars: 480 }),
      createApiLogFieldSnapshot("samplesText", samplesText, { sampleMode: "head-tail", maxChars: 640 }),
    ],
  });

  logAnalyze("info", "request:start", {
    requestId,
    provider,
    modelRequested: requestedModel || "(empty)",
    modelToRun,
    promptLength: prompt.length,
    hasCodexToken: Boolean(codexToken),
    hasApiKey: Boolean(normalizeApiKey(apiKey)),
    request: requestSnapshot,
  });

  const chatRequest = buildChatRequest({ provider, model: modelToRun, prompt, apiKey, codexToken, stream: false });

  if (isChatRequestError(chatRequest)) {
    const durationMs = Date.now() - startTime;
    const errorLabel = chatRequest.error;
    logAnalyze("warn", "request:failed", { requestId, provider, modelToRun, statusCode: chatRequest.status, durationMs, failureReason: chatRequest.error });
    return NextResponse.json(
      { error: errorLabel, _meta: { durationMs, statusCode: chatRequest.status, error: chatRequest.error, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
      { status: chatRequest.status },
    );
  }

  try {
    const res = await fetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body });
    const durationMs = Date.now() - startTime;
    const rawBody = await res.text();

    if (!res.ok) {
      const upstreamError = extractProviderError(provider, rawBody, res.headers.get("content-type"));
      const failureReason = `${provider} voice analysis failed: ${upstreamError}`;
      logAnalyze("warn", "request:failed", { requestId, provider, modelToRun, statusCode: res.status, durationMs, failureReason });
      return NextResponse.json(
        { error: "Voice analysis failed", _meta: { durationMs, statusCode: res.status, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
        { status: res.status },
      );
    }

    const result = parseCompletion(provider, rawBody, res.headers.get("content-type"), modelToRun);
    const upstreamModel = result.modelUsed || modelToRun;

    logAnalyze("info", "request:success", { requestId, provider, modelToRun, upstreamModel, durationMs, responseLength: result.content.length });

    return NextResponse.json({
      content: result.content,
      _meta: {
        durationMs,
        statusCode: 200,
        promptLength: prompt.length,
        responseLength: result.content.length,
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        cost: result.usage.cost,
        modelRequested: requestedModel,
        modelUsed: upstreamModel,
        request: requestSnapshot,
      },
    });
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const failureReason = `${provider} not reachable: ${asErrorMessage(error)}`;
    logAnalyze("error", "request:exception", { requestId, provider, modelToRun, durationMs, failureReason });
    return NextResponse.json(
      { error: "Provider not reachable", _meta: { durationMs, statusCode: 503, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
      { status: 503 },
    );
  }
}
