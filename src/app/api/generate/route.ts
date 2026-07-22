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
  transformStream,
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

// ─── SSE streaming helpers ────────────────────────────────────────────────────

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  "Connection": "keep-alive",
} as const;

function sseData(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function sseError(message: string, status = 500): Response {
  return new Response(sseData({ error: message, done: true }), { status, headers: SSE_HEADERS });
}

function logGenerate(
  level: "info" | "warn" | "error",
  stage: string,
  payload: Record<string, unknown>,
): void {
  const message = `[api/generate] ${stage}`;
  if (level === "error") return void console.error(message, payload);
  if (level === "warn") return void console.warn(message, payload);
  console.info(message, payload);
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(`generate:${getClientIp(req)}`, AI_RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfter);
  if (bodyTooLarge(req)) return payloadTooLargeResponse();

  const body = await req.json() as {
    contextAbove?: string;
    contextBelow?: string;
    goal?: string;
    audience?: string;
    tone?: string;
    remember?: string;
    userInstruction?: string;
    promptTemplate?: string;
    voiceContext?: string;
    model?: string;
    provider?: unknown;
    apiKey?: string;
    codexToken?: string;
    stream?: boolean;
  };
  const provider = body.provider;
  if (!isAIProvider(provider)) {
    return NextResponse.json(
      { error: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } },
      { status: 400 },
    );
  }
  const contextAbove = body.contextAbove || "";
  const contextBelow = body.contextBelow || "";
  const goal = body.goal || "";
  const audience = body.audience || "";
  const tone = body.tone || "";
  const remember = body.remember || "";
  const userInstruction = body.userInstruction || "";
  const promptTemplate = body.promptTemplate || "";
  const voiceContext = body.voiceContext || "";
  const requestedModel = body.model || "";
  const codexToken = body.codexToken;
  const apiKey = body.apiKey || getServerEnvKey(provider);
  const wantStream = Boolean(body.stream);

  let prompt = promptTemplate || "";
  prompt = prompt
    .replace("{goal}", goal || "No specific goal set")
    .replace("{audience}", audience || "General audience")
    .replace("{tone}", tone || "Match the surrounding text")
    .replace("{remember}", remember || "None")
    .replace("{contextAbove}", contextAbove || "(beginning of document)")
    .replace("{contextBelow}", contextBelow || "(end of document)")
    .replace("{userInstruction}", userInstruction || "");

  if (prompt.length > MAX_PROMPT_CHARS) return payloadTooLargeResponse();

  const startTime = Date.now();
  const requestId = createRequestId();
  const modelToRun = resolveModel(provider, requestedModel);
  const requestSnapshot = createApiLogRequestSnapshot({
    requestId,
    modelRequested: requestedModel,
    promptTemplate,
    fields: [
      createApiLogFieldSnapshot("goal", goal, { sampleMode: "full", maxChars: 240 }),
      createApiLogFieldSnapshot("audience", audience, { sampleMode: "full", maxChars: 240 }),
      createApiLogFieldSnapshot("tone", tone, { sampleMode: "full", maxChars: 240 }),
      createApiLogFieldSnapshot("remember", remember, { sampleMode: "head-tail", maxChars: 480 }),
      createApiLogFieldSnapshot("contextAbove", contextAbove, { sampleMode: "tail", maxChars: 480 }),
      createApiLogFieldSnapshot("contextBelow", contextBelow, { sampleMode: "head", maxChars: 480 }),
      createApiLogFieldSnapshot("userInstruction", userInstruction, { sampleMode: "full", maxChars: 320 }),
      createApiLogFieldSnapshot("voiceContext", voiceContext, { sampleMode: "head-tail", maxChars: 480 }),
    ],
  });

  logGenerate("info", "request:start", {
    requestId,
    provider,
    modelRequested: requestedModel || "(empty)",
    modelToRun,
    promptLength: prompt.length,
    hasCodexToken: Boolean(codexToken),
    hasApiKey: Boolean(normalizeApiKey(apiKey)),
    request: requestSnapshot,
  });

  const chatRequest = buildChatRequest({ provider, model: modelToRun, prompt, apiKey, codexToken, stream: wantStream, system: voiceContext });

  // ── Streaming path ──
  if (wantStream) {
    if (isChatRequestError(chatRequest)) {
      return sseError(chatRequest.error, chatRequest.status);
    }
    try {
      const res = await fetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body });
      if (!res.ok || !res.body) {
        return sseError(`${provider} request failed`, res.status);
      }
      return new Response(transformStream(provider, res.body), { headers: SSE_HEADERS });
    } catch {
      return sseError(`${provider} not reachable`, 503);
    }
  }

  // ── Non-streaming path ──
  if (isChatRequestError(chatRequest)) {
    const durationMs = Date.now() - startTime;
    const errorLabel = chatRequest.status === 401 ? "Provider not authenticated" : "No API key configured";
    logGenerate("warn", "request:failed", { requestId, provider, modelToRun, statusCode: chatRequest.status, durationMs, failureReason: chatRequest.error });
    return NextResponse.json(
      {
        error: errorLabel,
        _meta: { durationMs, statusCode: chatRequest.status, error: chatRequest.error, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot },
      },
      { status: chatRequest.status },
    );
  }

  try {
    const res = await fetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body });
    const durationMs = Date.now() - startTime;
    const rawBody = await res.text();

    if (!res.ok) {
      const upstreamError = extractProviderError(provider, rawBody, res.headers.get("content-type"));
      const failureReason = `${provider} generation failed: ${upstreamError}`;
      logGenerate("warn", "request:failed", { requestId, provider, modelToRun, statusCode: res.status, durationMs, failureReason });
      return NextResponse.json(
        {
          error: "Generation failed",
          _meta: { durationMs, statusCode: res.status, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot },
        },
        { status: res.status },
      );
    }

    const result = parseCompletion(provider, rawBody, res.headers.get("content-type"), modelToRun);
    const upstreamModel = result.modelUsed || modelToRun;

    logGenerate("info", "request:success", { requestId, provider, modelToRun, upstreamModel, durationMs, responseLength: result.content.length });

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
    logGenerate("error", "request:exception", { requestId, provider, modelToRun, durationMs, failureReason });
    return NextResponse.json(
      {
        error: "Provider not reachable",
        _meta: { durationMs, statusCode: 503, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot },
      },
      { status: 503 },
    );
  }
}
