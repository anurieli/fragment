import { NextRequest, NextResponse } from "next/server";
import {
  AI_RATE_LIMIT,
  bodyTooLarge,
  checkRateLimit,
  getClientIp,
  payloadTooLargeResponse,
  rateLimitResponse,
} from "@/lib/api-guards";
import {
  isAIProvider,
  resolveModel,
  buildChatRequest,
  isChatRequestError,
  extractProviderError,
} from "@/lib/ai/provider-runtime";

/**
 * Validate a provider credential for providers with no live /models endpoint
 * to prove a key actually works (today: Perplexity — its models fetch just
 * returns a canned 200). Everything else validates via getModels() instead
 * (see validateProviderCredential in ai-client.ts).
 *
 * Always responds HTTP 200 — correctness lives in the `ok` field, matching
 * /api/models' error-envelope style. Never uses the server env-key fallback:
 * this checks the user's own credential, not whatever the server has.
 */
export async function POST(req: NextRequest) {
  const rate = checkRateLimit(`validate-key:${getClientIp(req)}`, AI_RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfter);
  if (bodyTooLarge(req)) return payloadTooLargeResponse();

  const body = (await req.json()) as { provider?: unknown; apiKey?: string };
  const provider = body.provider;

  if (!isAIProvider(provider)) {
    return NextResponse.json({ ok: false, error: "Invalid provider" });
  }

  const apiKey = body.apiKey || "";
  const model = resolveModel(provider, "");
  // Minimal probe: a single "ping" message capped at 1 output token.
  const chatRequest = buildChatRequest({ provider, model, prompt: "ping", apiKey, stream: false, maxTokens: 1 });

  if (isChatRequestError(chatRequest)) {
    return NextResponse.json({ ok: false, error: chatRequest.error });
  }

  try {
    const res = await fetch(chatRequest.url, { method: "POST", headers: chatRequest.headers, body: chatRequest.body });
    if (res.ok) return NextResponse.json({ ok: true });

    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, error: "That key was rejected." });
    }

    const rawBody = await res.text();
    const upstreamError = extractProviderError(provider, rawBody, res.headers.get("content-type"));
    return NextResponse.json({ ok: false, error: upstreamError || "Couldn't validate that key." });
  } catch {
    return NextResponse.json({ ok: false, error: `Couldn't reach ${provider}.` });
  }
}
