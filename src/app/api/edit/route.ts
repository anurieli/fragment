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

function truncateText(text: string, maxLen = 300): string {
  const normalized = text.trim();
  if (!normalized) return "";
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function logEdit(
  level: "info" | "warn" | "error",
  stage: string,
  payload: Record<string, unknown>,
): void {
  const message = `[api/edit] ${stage}`;
  if (level === "error") return void console.error(message, payload);
  if (level === "warn") return void console.warn(message, payload);
  console.info(message, payload);
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(`edit:${getClientIp(req)}`, AI_RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfter);
  if (bodyTooLarge(req)) return payloadTooLargeResponse();

  const body = await req.json() as {
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

  const selectedText = body.selectedText || "";
  const contextBefore = body.contextBefore || "";
  const contextAfter = body.contextAfter || "";
  const goal = body.goal || "";
  const audience = body.audience || "";
  const tone = body.tone || "";
  const remember = body.remember || "";
  const instruction = body.instruction || "";
  const promptTemplate = body.promptTemplate || "";
  const voiceContext = body.voiceContext || "";
  const requestedModel = body.model || "";
  const codexToken = body.codexToken;
  const apiKey = body.apiKey || getServerEnvKey(provider);

  let prompt = promptTemplate || "";
  prompt = prompt
    .replace("{goal}", goal || "No specific goal set")
    .replace("{audience}", audience || "General audience")
    .replace("{tone}", tone || "Match the surrounding text")
    .replace("{remember}", remember || "None")
    .replace("{contextBefore}", contextBefore || "(beginning of document)")
    .replace("{contextAfter}", contextAfter || "(end of document)")
    .replace("{selectedText}", selectedText)
    .replace("{instruction}", instruction);

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
      createApiLogFieldSnapshot("selectedText", selectedText, { sampleMode: "head-tail", maxChars: 560 }),
      createApiLogFieldSnapshot("contextBefore", contextBefore, { sampleMode: "tail", maxChars: 480 }),
      createApiLogFieldSnapshot("contextAfter", contextAfter, { sampleMode: "head", maxChars: 480 }),
      createApiLogFieldSnapshot("instruction", instruction, { sampleMode: "full", maxChars: 320 }),
      createApiLogFieldSnapshot("voiceContext", voiceContext, { sampleMode: "head-tail", maxChars: 480 }),
    ],
  });

  logEdit("info", "request:start", {
    requestId,
    provider,
    modelRequested: requestedModel || "(empty)",
    modelToRun,
    promptLength: prompt.length,
    selectedTextLength: selectedText.length,
    instruction: truncateText(instruction, 100),
    request: requestSnapshot,
  });

  const chatRequest = buildChatRequest({ provider, model: modelToRun, prompt, apiKey, codexToken, stream: false, system: voiceContext });

  if (isChatRequestError(chatRequest)) {
    const durationMs = Date.now() - startTime;
    const errorLabel = chatRequest.reason === "no-key" ? "No API key configured" : "Provider not authenticated";
    logEdit("warn", "request:failed", { requestId, provider, modelToRun, statusCode: chatRequest.status, durationMs, failureReason: chatRequest.error });
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
      const failureReason = `${provider} edit failed: ${upstreamError}`;
      logEdit("warn", "request:failed", { requestId, provider, modelToRun, statusCode: res.status, durationMs, failureReason });
      return NextResponse.json(
        { error: "Edit failed", _meta: { durationMs, statusCode: res.status, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
        { status: res.status },
      );
    }

    const result = parseCompletion(provider, rawBody, res.headers.get("content-type"), modelToRun);
    const upstreamModel = result.modelUsed || modelToRun;

    logEdit("info", "request:success", { requestId, provider, modelToRun, upstreamModel, durationMs, responseLength: result.content.length });

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
    logEdit("error", "request:exception", { requestId, provider, modelToRun, durationMs, failureReason });
    return NextResponse.json(
      { error: "Provider not reachable", _meta: { durationMs, statusCode: 503, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
      { status: 503 },
    );
  }
}
