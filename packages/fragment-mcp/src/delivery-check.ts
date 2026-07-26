import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// Delivery preflight.
//
// fragment-mcp writes piece files straight to the inbox directory; the running
// Fragment app is what folds them into its store. Those are two different
// processes that can disagree, so a write that "succeeds" is not the same as a
// piece that ever reaches the user. This module answers the only question an
// agent actually cares about: *if I push now, will it show up?*
//
// The failure this exists to catch: the app's agent-inbox route is gated by
// Host, so a browser reaching the app over a tailnet/LAN name gets a 404 while
// a localhost probe gets a 200. The inbox then fills with files nothing will
// ever import, and every push reports success. Probing with the operator's real
// browser origin is the only check that sees this.
// ---------------------------------------------------------------------------

export type DeliveryState = "ok" | "app_down" | "ingress_blocked" | "unknown";

export interface DeliveryFinding {
  state: DeliveryState;
  /** One-line human summary. */
  summary: string;
  /** Concrete remediation, when we know it. */
  fix?: string;
  appUrl: string;
  /** Origin the human opens in a browser; what we send as Host when probing. */
  browserOrigin?: string;
  probeStatus?: number;
  /** Origin actually probed (browser origin when configured). */
  probedUrl?: string;
  pendingCount: number;
  oldestPendingMinutes?: number;
  everImported: boolean;
}

const PROBE_TIMEOUT_MS = 2500;

function resolveInboxDir(override?: string): string {
  return override ?? process.env.FRAGMENT_INBOX_DIR ?? path.join(os.homedir(), ".fragment", "inbox");
}

/** Where the app listens locally. */
export function resolveAppUrl(): string {
  return process.env.FRAGMENT_APP_URL ?? "http://127.0.0.1:3011";
}

/**
 * The origin the human actually opens. Set FRAGMENT_APP_ORIGIN when the app is
 * reached over a tailnet/LAN/proxy name rather than localhost: it is the Host
 * the browser sends, and therefore the Host the gate judges.
 */
export function resolveBrowserOrigin(): string | undefined {
  return process.env.FRAGMENT_APP_ORIGIN;
}

async function scanInbox(inboxDir: string): Promise<{ pending: number; oldestMs?: number; everImported: boolean }> {
  let pending = 0;
  let oldest: number | undefined;
  let everImported = false;

  async function walk(dir: string, depth: number): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".imported") {
          everImported = true;
          continue;
        }
        if (depth < 1) await walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith(".md")) continue;
      pending += 1;
      try {
        const stat = await fs.stat(full);
        if (oldest === undefined || stat.mtimeMs < oldest) oldest = stat.mtimeMs;
      } catch {
        /* raced with the app's ack; ignore */
      }
    }
  }

  await walk(inboxDir, 0);
  return { pending, oldestMs: oldest, everImported };
}

/**
 * Probe the app's agent-inbox route the way the browser reaches it. A 404 here
 * is the gate refusing that Host, not a missing route: the route answers 404
 * when closed precisely so it doesn't advertise itself.
 */
async function probe(
  appUrl: string,
  browserOrigin: string | undefined,
): Promise<{ status?: number; error?: string; probedUrl: string }> {
  // Probe the origin the human actually opens, not a spoofed Host on the local
  // URL: undici drops a manually set Host header, so header-spoofing silently
  // probes localhost and reports a pass while the browser is being refused.
  // Hitting the real URL exercises the real path, reverse proxy included.
  const target = browserOrigin ?? appUrl;
  const url = new URL("/api/v1/agent-inbox", target);
  url.searchParams.set("since", String(Date.now()));

  const headers: Record<string, string> = {};
  const token = process.env.FRAGMENT_INGRESS_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    return { status: res.status, probedUrl: url.origin };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), probedUrl: url.origin };
  } finally {
    clearTimeout(timer);
  }
}

/** Everything classifyDelivery needs, already resolved — pure and testable. */
export interface DeliveryEvidence {
  appUrl: string;
  browserOrigin?: string;
  probeStatus?: number;
  probeError?: string;
  probedUrl?: string;
  pendingCount: number;
  oldestPendingMinutes?: number;
  everImported: boolean;
}

/**
 * Turn raw probe + inbox evidence into a verdict. Pure — checkDelivery
 * gathers the evidence (fetch, fs) and this decides, so the decision matrix
 * is unit-testable without a running app.
 */
export function classifyDelivery(e: DeliveryEvidence): DeliveryFinding {
  const base = {
    appUrl: e.appUrl,
    browserOrigin: e.browserOrigin,
    probeStatus: e.probeStatus,
    probedUrl: e.probedUrl,
    pendingCount: e.pendingCount,
    oldestPendingMinutes: e.oldestPendingMinutes,
    everImported: e.everImported,
  };

  if (e.probeError !== undefined) {
    return {
      ...base,
      state: "app_down",
      summary: `Fragment is not answering at ${e.probedUrl} (${e.probeError}).`,
      fix: "Start the app (systemctl status fragment-app), or point FRAGMENT_APP_URL at where it listens. Pieces you push now will queue on disk until it comes back.",
    };
  }

  if (e.probeStatus === 404) {
    const who = `origin ${e.probedUrl}`;
    return {
      ...base,
      state: "ingress_blocked",
      summary: `Fragment is running, but its agent-inbox is closed to ${who}. Nothing you push will ever be imported.`,
      fix:
        "Set FRAGMENT_LOCAL_INGRESS=true and add the browser's hostname to FRAGMENT_INGRESS_ALLOWED_HOSTS on the app process, then restart it. " +
        "A localhost probe passes even while a tailnet/LAN host is refused, so check with the same origin you open in the browser.",
    };
  }

  if (e.probeStatus !== undefined && e.probeStatus >= 200 && e.probeStatus < 300) {
    // Route is reachable for this origin. Files still only move when the app is
    // open, so a backlog is worth reporting without calling it a failure.
    const stale = e.oldestPendingMinutes !== undefined && e.oldestPendingMinutes > 60;
    return {
      ...base,
      state: "ok",
      summary: stale
        ? `Ingress is open, but ${e.pendingCount} piece(s) are still waiting (oldest ${e.oldestPendingMinutes} min). Open Fragment to import them.`
        : `Ingress is open at ${e.appUrl}${e.pendingCount ? `; ${e.pendingCount} piece(s) waiting to import` : ""}.`,
    };
  }

  return {
    ...base,
    state: "unknown",
    summary: `Unexpected response ${e.probeStatus} from ${e.appUrl}.`,
  };
}

export async function checkDelivery(inboxDirOverride?: string): Promise<DeliveryFinding> {
  const inboxDir = resolveInboxDir(inboxDirOverride);
  const appUrl = resolveAppUrl();
  const browserOrigin = resolveBrowserOrigin();

  const [{ pending, oldestMs, everImported }, probed] = await Promise.all([
    scanInbox(inboxDir),
    probe(appUrl, browserOrigin),
  ]);

  const oldestPendingMinutes =
    oldestMs === undefined ? undefined : Math.round((Date.now() - oldestMs) / 60000);

  return classifyDelivery({
    appUrl,
    browserOrigin,
    probeStatus: probed.status,
    probeError: probed.error,
    probedUrl: probed.probedUrl,
    pendingCount: pending,
    oldestPendingMinutes,
    everImported,
  });
}

/** Multi-line report for `fragment-mcp doctor`. */
export function formatFinding(f: DeliveryFinding): string {
  const mark = f.state === "ok" ? "OK" : "FAIL";
  const lines = [
    `[${mark}] ${f.summary}`,
    "",
    `  app url         ${f.appUrl}`,
    `  browser origin  ${f.browserOrigin ?? "(unset — probing as localhost, which can pass while your browser is refused; set FRAGMENT_APP_ORIGIN)"}`,
    `  probed origin   ${f.probedUrl ?? f.appUrl}`,
    `  probe status    ${f.probeStatus ?? "no response"}`,
    `  pending pieces  ${f.pendingCount}${f.oldestPendingMinutes !== undefined ? ` (oldest ${f.oldestPendingMinutes} min)` : ""}`,
    `  imported before ${f.everImported ? "yes" : "no"}`,
  ];
  if (f.fix) lines.push("", `  fix: ${f.fix}`);
  return lines.join("\n");
}
