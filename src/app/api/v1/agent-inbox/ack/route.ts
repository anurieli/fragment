import os from "node:os";
import { NextRequest, NextResponse } from "next/server";

import { isHosted } from "@/lib/edition";
import { gateAgentInbox, parseAllowedHosts } from "@/lib/agent-inbox/gate";
import { getInboxDir, resolveInboxRelPath } from "@/lib/agent-inbox/paths";
import { ackImportedFile, appendStatusEvents, type StatusEvent } from "@/lib/agent-inbox/server-fs";

// Reads/writes the local filesystem — never runs on the edge runtime.
export const runtime = "nodejs";

interface AckRequestBody {
  imported?: unknown;
  statusEvents?: unknown;
}

function isStatusEvent(value: unknown): value is StatusEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.pieceId === "string" && typeof v.status === "string" && typeof v.at === "number";
}

/**
 * POST /api/v1/agent-inbox/ack
 *
 * Gated identically to GET /api/v1/agent-inbox (see gateAgentInbox) — 404
 * when closed.
 *
 * Body: `{ imported?: string[], statusEvents?: { pieceId, status, at }[] }`.
 * Every `imported` entry is a relPath as returned by the GET route; each is
 * independently validated with `resolveInboxRelPath` before any filesystem
 * write — a path that normalizes to `..` or is absolute is rejected, never
 * followed. Valid entries are moved into `.imported/` (uniquified on
 * filename collision). `statusEvents` are appended to `.status.jsonl` as
 * JSON lines tagged `by: "user"`.
 */
export async function POST(req: NextRequest) {
  const gate = gateAgentInbox(
    {
      isHosted: isHosted(),
      localIngressEnabled: process.env.FRAGMENT_LOCAL_INGRESS === "true",
      ingressToken: process.env.FRAGMENT_INGRESS_TOKEN,
      allowedHosts: parseAllowedHosts(process.env.FRAGMENT_INGRESS_ALLOWED_HOSTS),
    },
    req.headers.get("host"),
    req.headers.get("authorization"),
  );
  if (!gate.allowed) {
    return new NextResponse(null, { status: 404 });
  }

  let body: AckRequestBody;
  try {
    body = (await req.json()) as AckRequestBody;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const inboxDir = getInboxDir({
    homeDir: os.homedir(),
    inboxDirOverride: process.env.FRAGMENT_INBOX_DIR,
  });

  const importedRelPaths = Array.isArray(body.imported)
    ? body.imported.filter((p): p is string => typeof p === "string")
    : [];

  const results = [];
  for (const relPath of importedRelPaths) {
    // Defense in depth: reject anything that doesn't resolve inside the
    // inbox dir before ever touching the filesystem for it. ackImportedFile
    // re-checks this itself, but failing fast here keeps the loop's intent
    // obvious and lets us report a clean per-path result either way.
    if (!resolveInboxRelPath(inboxDir, relPath)) {
      results.push({ relPath, ok: false, error: "invalid path" });
      continue;
    }
    results.push(await ackImportedFile(inboxDir, relPath));
  }

  const statusEvents = Array.isArray(body.statusEvents) ? body.statusEvents.filter(isStatusEvent) : [];
  if (statusEvents.length > 0) {
    await appendStatusEvents(inboxDir, statusEvents);
  }

  return NextResponse.json({ results });
}
