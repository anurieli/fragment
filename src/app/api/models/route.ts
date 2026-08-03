import { NextRequest, NextResponse } from "next/server";
import {
  MODELS_RATE_LIMIT,
  checkRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/api-guards";
import {
  isAIProvider,
  getServerEnvKey,
  getStaticModels,
  buildModelsRequest,
  parseModels,
} from "@/lib/ai/provider-runtime";

export async function GET(req: NextRequest) {
  const rate = checkRateLimit(`models:${getClientIp(req)}`, MODELS_RATE_LIMIT);
  if (!rate.ok) return rateLimitResponse(rate.retryAfter);

  const providerParam = req.nextUrl.searchParams.get("provider") || "openrouter";
  const startTime = Date.now();

  if (!isAIProvider(providerParam)) {
    return NextResponse.json(
      { models: [], _meta: { durationMs: 0, statusCode: 400, error: "Invalid provider" } },
      { status: 400 },
    );
  }
  const provider = providerParam;

  // Providers without a list endpoint (Perplexity) serve a curated static list.
  const staticModels = getStaticModels(provider);
  if (staticModels) {
    return NextResponse.json({ models: staticModels, _meta: { durationMs: Date.now() - startTime, statusCode: 200 } });
  }

  const apiKey = req.headers.get("x-api-key") || getServerEnvKey(provider);
  const codexToken = req.headers.get("x-auth-token") || undefined;
  const modelsRequest = buildModelsRequest(provider, { apiKey, codexToken });

  if (!modelsRequest) {
    const error = provider === "codex" ? "Not authenticated with Codex" : "Missing API key";
    return NextResponse.json(
      {
        models: [],
        error,
        code: "AI_AUTH_REQUIRED",
        _meta: { durationMs: Date.now() - startTime, statusCode: 401, error },
      },
      { status: 401 },
    );
  }

  try {
    // Only OpenRouter's public list is safe to cache; keyed/authed lists are not.
    const fetchInit: RequestInit & { next?: { revalidate: number } } =
      provider === "openrouter" ? { headers: modelsRequest.headers, next: { revalidate: 3600 } } : { headers: modelsRequest.headers };
    const res = await fetch(modelsRequest.url, fetchInit);
    const durationMs = Date.now() - startTime;

    if (!res.ok) {
      return NextResponse.json(
        { models: [], _meta: { durationMs, statusCode: res.status, error: `${provider} models fetch failed` } },
        { status: res.status },
      );
    }

    const models = parseModels(provider, await res.text());
    return NextResponse.json({ models, _meta: { durationMs, statusCode: 200 } });
  } catch {
    return NextResponse.json({
      models: [],
      error: `${provider} not reachable`,
      _meta: { durationMs: Date.now() - startTime, statusCode: 503, error: `${provider} not reachable` },
    });
  }
}
