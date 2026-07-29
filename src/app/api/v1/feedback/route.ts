import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured, query } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/api-guards";
import { putBlob, BlobTooLarge } from "@/lib/server/blob-store";

export const runtime = "nodejs";

const TYPES = new Set(["bug", "feature", "feedback"]);

/**
 * POST /api/v1/feedback  (multipart/form-data)
 *
 *   payload         — JSON metadata
 *   screenshot      — optional file
 *   screenRecording — optional file
 *   voiceNote       — optional file
 *
 * One request rather than the upload-url dance the Convex client used: with
 * our own storage there is no third party to hand a signed URL, so asking for
 * one first would be a round trip that buys nothing.
 */
/** Anonymous callers can write here, so the volume needs a ceiling. */
const FEEDBACK_RATE_LIMIT = { limit: 10, windowMs: 60_000 } as const;

export async function POST(req: NextRequest) {
  const budget = checkRateLimit(`feedback:${getClientIp(req)}`, FEEDBACK_RATE_LIMIT);
  if (!budget.ok) return rateLimitResponse(budget.retryAfter);

  if (!isDatabaseConfigured()) return NextResponse.json({ ok: true });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart form data" }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(String(form.get("payload") ?? "{}"));
  } catch {
    return NextResponse.json({ error: "payload is not valid JSON" }, { status: 400 });
  }

  const type = String(payload.type ?? "");
  const message = String(payload.message ?? "").trim();

  if (!TYPES.has(type)) {
    return NextResponse.json({ error: "type must be bug, feature or feedback" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const user = await getSessionUser();

  async function store(field: string): Promise<string | null> {
    const file = form.get(field);
    if (!file || typeof file === "string") return null;
    const blob = file as File;
    if (blob.size === 0) return null;
    return putBlob(await blob.arrayBuffer(), blob.type || "application/octet-stream");
  }

  try {
    const [screenshotKey, recordingKey, voiceKey] = await Promise.all([
      store("screenshot"),
      store("screenRecording"),
      store("voiceNote"),
    ]);

    await query(
      `insert into feedback (
         device_id, user_id, type, message,
         screenshot_key, screen_recording_key, voice_note_key,
         platform, app_version, screen_resolution, user_agent, active_note_id
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        payload.deviceId ?? null,
        user?.id ?? null,
        type,
        message,
        screenshotKey,
        recordingKey,
        voiceKey,
        payload.platform ?? null,
        payload.appVersion ?? null,
        payload.screenResolution ?? null,
        payload.userAgent ?? null,
        payload.activeNoteId ?? null,
      ],
    );
  } catch (err) {
    if (err instanceof BlobTooLarge) {
      return NextResponse.json({ error: err.message }, { status: 413 });
    }
    console.error("[feedback] failed:", err);
    return NextResponse.json({ error: "Failed to record feedback" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
