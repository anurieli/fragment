/**
 * Request guards for the public AI route handlers.
 *
 * These are the "don't get robbed" protections for the four `/api/*` AI
 * endpoints, which are internet-facing and (until Phase 1 auth lands)
 * unauthenticated: per-IP rate limiting and payload-size caps.
 *
 * The rate limiter is in-memory and therefore per-serverless-instance — a
 * best-effort backstop, not a distributed guarantee. Wire it to Upstash Redis
 * (UPSTASH_REDIS_REST_URL) in Phase 1 for a shared, accurate limit. Even
 * per-instance, it meaningfully caps a single abuser hammering one region.
 */

import { NextResponse, type NextRequest } from "next/server";

// ─── Limits ───────────────────────────────────────────────────────────────

/** Max accepted request body, in bytes. Generous enough for very long essays. */
export const MAX_BODY_BYTES = 1_000_000; // ~1 MB

/** Max characters in a fully-composed prompt sent upstream. */
export const MAX_PROMPT_CHARS = 500_000;

/** Default per-IP budget for the AI POST routes. */
export const AI_RATE_LIMIT = { limit: 20, windowMs: 60_000 } as const;

/** Slightly looser budget for the read-only models list. */
export const MODELS_RATE_LIMIT = { limit: 40, windowMs: 60_000 } as const;

// ─── Client IP ──────────────────────────────────────────────────────────────

export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

// ─── Rate limiting (fixed window, in-memory) ─────────────────────────────────

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastPrune = 0;

/** Drop expired buckets occasionally so the map can't grow without bound. */
function pruneExpired(now: number): void {
  if (now - lastPrune < 60_000) return;
  lastPrune = now;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when `ok` is false). */
  retryAfter: number;
}

export function checkRateLimit(
  key: string,
  { limit, windowMs }: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }
  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

// ─── Response helpers ─────────────────────────────────────────────────────────

/** 429 with a Retry-After header. Shape matches the routes' error envelope. */
export function rateLimitResponse(retryAfter: number): NextResponse {
  return NextResponse.json(
    {
      error: "Rate limit exceeded. Please slow down and try again shortly.",
      _meta: { durationMs: 0, statusCode: 429, error: "Rate limit exceeded" },
    },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** 413 for an over-large request body. */
export function payloadTooLargeResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "Request too large.",
      _meta: { durationMs: 0, statusCode: 413, error: "Payload too large" },
    },
    { status: 413 },
  );
}

/**
 * Reject a request whose declared body size exceeds the cap, before it is
 * parsed. A missing/chunked Content-Length is allowed through here and caught
 * downstream by the prompt-length guard.
 */
export function bodyTooLarge(req: NextRequest, maxBytes = MAX_BODY_BYTES): boolean {
  const declared = Number(req.headers.get("content-length") || 0);
  return declared > maxBytes;
}
