import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Where feedback attachments go.
 *
 * Convex handed us file storage for free; Postgres does not, and screen
 * recordings have no business sitting in a jsonb column. This is the smallest
 * thing that keeps the feature working: files on disk, a key in the database.
 *
 * The seam for object storage is `putBlob`/`getBlob`. A hosted deployment
 * swaps the two bodies for S3 or R2 calls and nothing else changes, because
 * callers only ever hold an opaque key.
 */

const MAX_BLOB_BYTES = 25 * 1024 * 1024;

export class BlobTooLarge extends Error {}

function blobRoot(): string {
  return process.env.FRAGMENT_BLOB_DIR ?? path.join(os.homedir(), ".fragment", "blobs");
}

/**
 * Keys are generated here, never taken from a caller. A caller-supplied name
 * is a path traversal waiting to happen, and there is no reason to accept one.
 */
export async function putBlob(data: ArrayBuffer, contentType: string): Promise<string> {
  if (data.byteLength > MAX_BLOB_BYTES) {
    throw new BlobTooLarge(`Attachment exceeds ${MAX_BLOB_BYTES} bytes`);
  }

  const id = randomUUID();
  // Shard by first two characters so one directory does not accumulate every
  // upload the deployment has ever taken.
  const shard = id.slice(0, 2);
  const dir = path.join(blobRoot(), shard);
  await mkdir(dir, { recursive: true });

  const key = `${shard}/${id}`;
  await writeFile(path.join(blobRoot(), key), Buffer.from(data));
  await writeFile(
    path.join(blobRoot(), `${key}.meta`),
    JSON.stringify({ contentType, size: data.byteLength, createdAt: Date.now() }),
  );

  return key;
}

export async function getBlob(key: string): Promise<{ data: Buffer; contentType: string } | null> {
  // Even though keys are ours, refuse anything that could escape the root:
  // the check costs nothing and survives a future caller-supplied key.
  if (!/^[0-9a-f]{2}\/[0-9a-f-]{36}$/.test(key)) return null;

  try {
    const data = await readFile(path.join(blobRoot(), key));
    let contentType = "application/octet-stream";
    try {
      const meta = JSON.parse(await readFile(path.join(blobRoot(), `${key}.meta`), "utf8"));
      if (typeof meta.contentType === "string") contentType = meta.contentType;
    } catch {
      // Missing metadata is not a reason to withhold the file.
    }
    return { data, contentType };
  } catch {
    return null;
  }
}
