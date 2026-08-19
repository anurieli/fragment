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

function logExtract(
  level: "info" | "warn" | "error",
  stage: string,
  payload: Record<string, unknown>,
): void {
  const message = `[api/extract] ${stage}`;
  if (level === "error") return void console.error(message, payload);
  if (level === "warn") return void console.warn(message, payload);
  console.info(message, payload);
}

/**
 * The idea extractor. Reads a whole idea and returns pieces that stand alone.
 *
 * Returns the raw model completion as `content`; parsing the JSON array into
 * pieces happens client-side in lib/agents/extract.ts, so the web and Tauri
 * paths behave identically and a malformed response is handled in one place.
 */
export async function POST(req: NextRequest) {
  const rate = checkRateLimit(`extract:${getClientIp(req)}`, AI_RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfter);
  if (bodyTooLarge(req)) return payloadTooLargeResponse();

  const body = await req.json() as {
    source?: string;
    goal?: string;
    audience?: string;
    tone?: string;
    remember?: string;
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

  const source = body.source || "";
  const goal = body.goal || "";
  const audience = body.audience || "";
  const tone = body.tone || "";
  const remember = body.remember || "";
  const promptTemplate = body.promptTemplate || "";
  const requestedModel = body.model || "";
  const codexToken = body.codexToken;
  const apiKey = body.apiKey || getServerEnvKey(provider);

  // Single-pass substitution with a function replacer, for the same two reasons
  // as /api/analyze-voice: a string replacement value special-cases $$, $&, $`
  // and $', and the source here is raw draft content that can contain them; and
  // one pass means a literal {source} inside the writer's own text cannot
  // hijack the real placeholder.
  const substitutions: Record<string, string> = {
    "{source}": source || "(nothing written in this idea yet)",
    "{goal}": goal || "No specific goal set",
    "{audience}": audience || "General audience",
    "{tone}": tone || "Match the source material",
    "{remember}": remember || "None",
  };
  const prompt = (promptTemplate || "").replace(
    /\{source\}|\{goal\}|\{audience\}|\{tone\}|\{remember\}/g,
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
      createApiLogFieldSnapshot("goal", goal, { sampleMode: "full", maxChars: 200 }),
      createApiLogFieldSnapshot("audience", audience, { sampleMode: "full", maxChars: 200 }),
      createApiLogFieldSnapshot("source", source, { sampleMode: "head-tail", maxChars: 640 }),
    ],
  });

  logExtract("info", "request:start", {
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
    const errorLabel = chatRequest.reason === "no-key" ? "No API key configured" : "Provider not authenticated";
    logExtract("warn", "request:failed", { requestId, provider, modelToRun, statusCode: chatRequest.status, durationMs, failureReason: chatRequest.error });
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
      const failureReason = `${provider} extraction failed: ${upstreamError}`;
      logExtract("warn", "request:failed", { requestId, provider, modelToRun, statusCode: res.status, durationMs, failureReason });
      return NextResponse.json(
        { error: "Extraction failed", _meta: { durationMs, statusCode: res.status, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
        { status: res.status },
      );
    }

    const result = parseCompletion(provider, rawBody, res.headers.get("content-type"), modelToRun);
    const upstreamModel = result.modelUsed || modelToRun;

    logExtract("info", "request:success", { requestId, provider, modelToRun, upstreamModel, durationMs, responseLength: result.content.length });

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
    logExtract("error", "request:exception", { requestId, provider, modelToRun, durationMs, failureReason });
    return NextResponse.json(
      { error: "Provider not reachable", _meta: { durationMs, statusCode: 503, error: failureReason, promptLength: prompt.length, responseLength: 0, modelRequested: requestedModel, modelUsed: modelToRun, request: requestSnapshot } },
      { status: 503 },
    );
  }
}
