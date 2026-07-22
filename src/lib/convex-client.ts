const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL || process.env.NEXT_PUBLIC_CONVEX_URL;

// --- Payload types ---

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
  screenshotId?: string;
  screenRecordingId?: string;
  voiceNoteId?: string;
  platform?: string;
  appVersion?: string;
  screenResolution?: string;
  userAgent?: string;
  activeNoteId?: string;
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

// --- HTTP helpers ---

async function postJson(endpoint: string, body: unknown): Promise<Response> {
  const res = await fetch(`${CONVEX_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${endpoint} failed: ${res.status} ${res.statusText}`);
  }
  return res;
}

// --- Exported functions ---

export async function identify(payload: IdentifyPayload): Promise<void> {
  if (!CONVEX_URL) return;
  await postJson("/identify", payload);
}

export async function getUploadUrl(deviceId: string): Promise<{ uploadUrl: string }> {
  if (!CONVEX_URL) return { uploadUrl: "" };
  const res = await postJson("/upload-url", { deviceId });
  return res.json() as Promise<{ uploadUrl: string }>;
}

export async function uploadFile(
  uploadUrl: string,
  blob: Blob,
): Promise<string> {
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": blob.type },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`Upload failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as { storageId: string };
  return data.storageId;
}

export async function submitFeedback(
  deviceId: string,
  data: Omit<FeedbackPayload, "deviceId">,
  fileBlobs?: FeedbackFiles,
): Promise<void> {
  if (!CONVEX_URL) return;

  // Upload files in parallel
  const uploads = await Promise.all([
    fileBlobs?.screenshot
      ? getUploadUrl(deviceId).then((u) => uploadFile(u.uploadUrl, fileBlobs.screenshot!))
      : Promise.resolve(undefined),
    fileBlobs?.screenRecording
      ? getUploadUrl(deviceId).then((u) =>
          uploadFile(u.uploadUrl, fileBlobs.screenRecording!),
        )
      : Promise.resolve(undefined),
    fileBlobs?.voiceNote
      ? getUploadUrl(deviceId).then((u) => uploadFile(u.uploadUrl, fileBlobs.voiceNote!))
      : Promise.resolve(undefined),
  ]);

  const payload: FeedbackPayload = {
    ...data,
    deviceId,
    screenshotId: uploads[0],
    screenRecordingId: uploads[1],
    voiceNoteId: uploads[2],
  };

  await postJson("/feedback", payload);
}

export async function syncLogs(
  deviceId: string,
  logs: SyncableLog[],
): Promise<void> {
  if (!CONVEX_URL) return;
  await postJson("/logs", { deviceId, logs });
}
