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

function logLabel(
  level: "info" | "warn" | "error",
  stage: string,
  payload: Record<string, unknown>,
): void {
  const message = `[api/label] ${stage}`;
  if (level === "error") return void console.error(message, payload);
  if (level === "warn") return void console.warn(message, payload);
  console.info(message, payload);
}

export async function POST(req: NextRequest) {
  const rate = checkRateLimit(`label:${getClientIp(req)}`, AI_RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfter);
  if (bodyTooLarge(req)) return payloadTooLargeResponse();

  const body = await req.json() as {
    snippetContent?: string;
    essayContent?: string;
    goal?: string;
    promptTemplate?: string;
    model?: string;
    provider?: unknown;
    apiKey?: string;
    codexToken?: string;
  };
  const provider = body.provider;
  if (!isAIProvider(provider)) {
    return NextResponse.json(
      { label: "Invalid provider", _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider", promptLength: 0, responseLength: 0 } },
      { status: 400 },
    );
  }

  const snippetContent = body.snippetContent || "";
  const essayContent = body.essayContent || "";
  const goal = body.goal || "";
  const promptTemplate = body.promptTemplate || "";
  const requestedModel = body.model || "";
  const codexToken = body.codexToken;
  const apiKey = body.apiKey || getServerEnvKey(provider);

  let prompt = promptTemplate || "";
  const goalSuffix = goal ? ` with this goal: "${goal}"` : "";
  const essayBlock = essayContent
    ? `Here is their full essay so far:\n---\n${essayContent}\n---\n\n`
    : "";
  prompt = prompt
    .replace("{goal}", goalSuffix)
    .replace("{essayContent}", essayBlock)
    .replace("{snippetContent}", snippetContent);

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
      createApiLogFieldSnapshot("essayContent", essayContent, { sampleMode: "head-tail", maxChars: 560 }),
      createApiLogFieldSnapshot("snippetContent", snippetContent, { sampleMode: "head-tail", maxChars: 560 }),
    ],
  });

  logLabel("info", "request:start", {
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
    logLabel("warn", "request:failed", { requestId, provider, modelToRun, statusCode: chatRequest.status, durationMs, failureReason: chatRequest.error });
    return NextResponse.json(
      { error: chatRequest.error, _meta: { durationMs, statusCode: chatRequest.status, error: chatRequest.error, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
      { status: chatRequest.status },
    );
  }

  try {
    const res = await fetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body });
    const durationMs = Date.now() - startTime;
    const rawBody = await res.text();

    if (!res.ok) {
      const upstreamError = extractProviderError(provider, rawBody, res.headers.get("content-type"));
      const failureReason = `${provider} labeling failed: ${upstreamError}`;
      logLabel("warn", "request:failed", { requestId, provider, modelToRun, statusCode: res.status, durationMs, failureReason });
      return NextResponse.json(
        { label: "AI labeling failed", _meta: { durationMs, statusCode: res.status, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
        { status: res.status },
      );
    }

    const result = parseCompletion(provider, rawBody, res.headers.get("content-type"), modelToRun);
    const label = result.content || "Unlabeled";
    const upstreamModel = result.modelUsed || modelToRun;

    logLabel("info", "request:success", { requestId, provider, modelToRun, upstreamModel, durationMs, responseLength: label.length });

    return NextResponse.json({
      label,
      _meta: {
        durationMs,
        statusCode: 200,
        promptLength: prompt.length,
        responseLength: label.length,
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
    logLabel("error", "request:exception", { requestId, provider, modelToRun, durationMs, failureReason });
    return NextResponse.json(
      { label: "AI labeling failed", _meta: { durationMs, statusCode: 503, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
      { status: 503 },
    );
  }
}
