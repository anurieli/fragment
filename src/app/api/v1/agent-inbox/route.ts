import os from "node:os";
import { NextRequest, NextResponse } from "next/server";

import { isHosted } from "@/lib/edition";
import { gateAgentInbox, parseAllowedHosts } from "@/lib/agent-inbox/gate";
import { getInboxDir } from "@/lib/agent-inbox/paths";
import { listIdeaFiles, listPendingHandoffFiles, listPendingResourceFiles } from "@/lib/agent-inbox/server-fs";

// Reads the local filesystem — never runs on the edge runtime.
export const runtime = "nodejs";

/**
 * GET /api/v1/agent-inbox?since=<epoch-ms>
 *
 * Local-ingress-only, gated by `gateAgentInbox` (see src/lib/agent-inbox/gate.ts):
 * closed on the hosted build, closed unless FRAGMENT_LOCAL_INGRESS=true, and
 * closed to non-localhost requests without the exact FRAGMENT_INGRESS_TOKEN
 * bearer token. The gate is closed → 404 (never 401/403, so the endpoint's
 * existence isn't revealed).
 *
 * Lists pending contract-format `.md` files from the inbox directory
 * (`~/.fragment/inbox`, or FRAGMENT_INBOX_DIR) recursively, including
 * per-idea subdirectories, excluding `.imported/` and `.status.jsonl`. Also
 * lists every idea's `resources.jsonl` (ARI-162 — fragment-mcp's
 * `add_resource` tool), always in full (no `since` filter — the importer's
 * idempotent-by-id upsert makes re-reading the whole file on every poll
 * cheap and safe). Never follows client-supplied paths — this route only
 * reads, it doesn't accept a path from the caller.
 */
export async function GET(req: NextRequest) {
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

  const sinceParam = req.nextUrl.searchParams.get("since");
  const since = sinceParam !== null ? Number(sinceParam) : undefined;
  const sinceMs = since !== undefined && Number.isFinite(since) ? since : undefined;

  const inboxDir = getInboxDir({
    homeDir: os.homedir(),
    inboxDirOverride: process.env.FRAGMENT_INBOX_DIR,
  });

  const [files, resourceFiles, ideaFiles] = await Promise.all([
    listPendingHandoffFiles(inboxDir, sinceMs),
    listPendingResourceFiles(inboxDir),
    listIdeaFiles(inboxDir),
  ]);
  return NextResponse.json({ files, resourceFiles, ideaFiles });
}
