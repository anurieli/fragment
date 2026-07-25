"use client";

import { isTauri } from "@/lib/ai-client";

/**
 * Appends a piece status change to the agent inbox's `.status.jsonl` via the
 * existing ack route (see `src/app/api/v1/agent-inbox/ack/route.ts`,
 * `appendStatusEvents` in `server-fs.ts`) so an agent watching that log sees
 * status transitions the user makes locally — e.g. marking a piece it
 * dropped off as "ready" or "published". Reuses the exact same wire shape
 * `use-agent-inbox.ts`'s `ackIngress` uses for the `imported` half of that
 * route, just for the `statusEvents` half instead.
 *
 * Best-effort and silent by design, same posture as `useAgentInbox`'s own
 * polling: the route 404s when local ingress isn't enabled (self-host
 * default) or this is the hosted build, Tauri's static export has no
 * Next.js server to call at all (skipped up front), and a relative fetch()
 * URL with no document origin (e.g. a non-browser test runner) can throw
 * synchronously rather than reject — none of that should ever surface to
 * the user or interrupt the status change that triggered it.
 */
export function notifyAgentInboxStatusChange(pieceId: string, status: string): void {
  if (isTauri()) return;
  if (typeof fetch !== "function") return;

  try {
    fetch("/api/v1/agent-inbox/ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statusEvents: [{ pieceId, status, at: Date.now() }] }),
    }).catch(() => {});
  } catch {
    // Synchronous throw (e.g. relative URL with no base outside a browser) —
    // nothing to recover, this is a nice-to-have signal for agents, never a
    // blocking write.
  }
}
