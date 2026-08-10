/**
 * Telemetry and feedback, pointed at Fragment's own backend.
 *
 * Replaces the Convex client. The exported shapes are unchanged so that call
 * sites only swapped an import: what moved is where the data lands, from a
 * third-party backend to the same Postgres that holds everything else.
 *
 * Every function here is best-effort and silent on failure. None of this is
 * the user's writing, and a telemetry outage must never surface as an error
 * in a text editor.
 */

export interface IdentifyPayload {
  deviceId: string;
  name?: string;
  email?: string;
  platform?: string;
  appVersion?: string;
  writingTypes?: string[];
  role?: string;
  profileSource?: string;
}

export interface FeedbackPayload {
  deviceId: string;
  type: "bug" | "feature" | "feedback";
  message: string;
  platform?: string;
  appVersion?: string;
  screenResolution?: string;
  userAgent?: string;
  activePieceId?: string;
}

export interface SyncableLog {
  route: string;
  caller: string;
  provider: string;
  model: string;
  status: string;
  statusCode: number;
  error?: string;
  durationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  promptLength: number;
  responseLength: number;
  clientTimestamp: number;
}

export interface FeedbackFiles {
  screenshot?: Blob;
  screenRecording?: Blob;
  voiceNote?: Blob;
}

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_FRAGMENT_API_BASE ?? "").replace(/\/$/, "");
}

export async function identify(payload: IdentifyPayload): Promise<void> {
  try {
    await fetch(`${apiBase()}/api/v1/identify`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Offline, or no backend. Neither is worth telling anyone about.
  }
}

export async function submitFeedback(
  deviceId: string,
  data: Omit<FeedbackPayload, "deviceId">,
  fileBlobs?: FeedbackFiles,
): Promise<void> {
  const form = new FormData();
  form.set("payload", JSON.stringify({ ...data, deviceId }));

  if (fileBlobs?.screenshot) form.set("screenshot", fileBlobs.screenshot, "screenshot.png");
  if (fileBlobs?.screenRecording) {
    form.set("screenRecording", fileBlobs.screenRecording, "recording.webm");
  }
  if (fileBlobs?.voiceNote) form.set("voiceNote", fileBlobs.voiceNote, "voice.webm");

  // Unlike identify and syncLogs, this one throws: the feedback panel reports
  // success to the person who took the trouble to write it, and claiming a
  // report was filed when it was not is worse than showing a failure.
  const res = await fetch(`${apiBase()}/api/v1/feedback`, {
    method: "POST",
    credentials: "include",
    body: form,
  });

  if (!res.ok) {
    throw new Error(`Feedback submission failed: ${res.status}`);
  }
}

export async function syncLogs(deviceId: string, logs: SyncableLog[]): Promise<void> {
  if (logs.length === 0) return;
  try {
    await fetch(`${apiBase()}/api/v1/logs`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, logs }),
    });
  } catch {
    // Logs stay queued locally and go out with the next batch.
  }
}
