import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured, query } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";

export const runtime = "nodejs";

const MAX_LOGS_PER_REQUEST = 200;

/**
 * POST /api/v1/logs
 *
 * Batched AI-call telemetry: which provider, which model, how long, how many
 * tokens. One way only. These rows never sync back down to a client, which is
 * why they are not part of the documents table.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: true });

  let body: { deviceId?: string; logs?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.logs)) {
    return NextResponse.json({ error: "logs must be an array" }, { status: 400 });
  }

  const logs = body.logs.slice(0, MAX_LOGS_PER_REQUEST) as Record<string, unknown>[];
  if (logs.length === 0) return NextResponse.json({ ok: true });

  const user = await getSessionUser();

  try {
    // One statement for the batch; unnest keeps it a single round trip
    // regardless of how many calls the client queued while offline.
    await query(
      `insert into api_logs (
         device_id, user_id, route, caller, provider, model, status, status_code,
         error, duration_ms, prompt_tokens, completion_tokens, total_tokens,
         cost, prompt_length, response_length, client_timestamp
       )
       select $1, $2, l.route, l.caller, l.provider, l.model, l.status, l.status_code,
              l.error, l.duration_ms, l.prompt_tokens, l.completion_tokens, l.total_tokens,
              l.cost, l.prompt_length, l.response_length, l.client_timestamp
         from unnest(
                $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int[],
                $9::text[], $10::int[], $11::int[], $12::int[], $13::int[],
                $14::double precision[], $15::int[], $16::int[], $17::bigint[]
              ) as l(route, caller, provider, model, status, status_code,
                     error, duration_ms, prompt_tokens, completion_tokens, total_tokens,
                     cost, prompt_length, response_length, client_timestamp)`,
      [
        body.deviceId ?? null,
        user?.id ?? null,
        logs.map((l) => String(l.route ?? "")),
        logs.map((l) => (l.caller == null ? null : String(l.caller))),
        logs.map((l) => (l.provider == null ? null : String(l.provider))),
        logs.map((l) => (l.model == null ? null : String(l.model))),
        logs.map((l) => (l.status == null ? null : String(l.status))),
        logs.map((l) => numeric(l.statusCode)),
        logs.map((l) => (l.error == null ? null : String(l.error).slice(0, 2000))),
        logs.map((l) => numeric(l.durationMs)),
        logs.map((l) => numeric(l.promptTokens)),
        logs.map((l) => numeric(l.completionTokens)),
        logs.map((l) => numeric(l.totalTokens)),
        logs.map((l) => (typeof l.cost === "number" ? l.cost : null)),
        logs.map((l) => numeric(l.promptLength)),
        logs.map((l) => numeric(l.responseLength)),
        logs.map((l) => numeric(l.clientTimestamp)),
      ],
    );
  } catch (err) {
    console.error("[logs] failed:", err);
    return NextResponse.json({ error: "Failed to record logs" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}
