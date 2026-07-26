import { NextRequest, NextResponse } from "next/server";

import { isHosted } from "@/lib/edition";
import { gateAgentInbox, parseAllowedHosts } from "@/lib/agent-inbox/gate";
import { buildComposioRequest, type ComposioAction } from "@/lib/composio/linkedin";

// Talks to backend.composio.dev server-side — never runs on the edge runtime
// (not that it needs Node APIs here, but this keeps it consistent with the
// other local-ingress routes and leaves room for future Node-only needs).
export const runtime = "nodejs";

/**
 * POST /api/v1/publish/linkedin
 *
 * Gated proxy for the three Composio calls "Publish to LinkedIn" (ARI-155)
 * needs: starting a Connect Link session, polling connection status, and
 * executing a LinkedIn tool (resolve-author-URN, then create-post). Exists
 * because `backend.composio.dev` does not reliably send CORS headers for
 * third-party browser origins, and Composio's own docs recommend a
 * server-side proxy over a raw API key in browser code — see the spike
 * write-up at the top of `src/lib/composio/linkedin.ts`.
 *
 * Reuses the exact same local-ingress gate as the agent-inbox routes (see
 * `gateAgentInbox` in `src/lib/agent-inbox/gate.ts`): closed on the hosted
 * SaaS build, closed unless `FRAGMENT_LOCAL_INGRESS=true`, and closed to
 * non-localhost requests without the exact `FRAGMENT_INGRESS_TOKEN` bearer
 * token. Gate closed -> 404 (never 401/403, so the endpoint's existence
 * isn't revealed).
 *
 * NOTE: this means the hosted SaaS build cannot publish to LinkedIn through
 * this route at all today — it has no local filesystem/ingress story to
 * gate on. A real server-side Composio integration for the hosted build
 * (its own auth, no BYO key) is tracked separately — see ARI-161. The
 * `ComposioTransport` seam in `linkedin.ts` exists specifically so that
 * swap doesn't require touching any call site.
 *
 * The Tauri desktop build never hits this route — it has no Next.js server
 * (static export) and calls Composio directly instead, via
 * `directComposioTransport` (Tauri's native HTTP plugin isn't subject to
 * the WebView's CORS policy).
 *
 * Body: a `ComposioAction` discriminated union (`{ kind: "link" | "status" |
 * "execute", ... }` — see `linkedin.ts`), reconstructed into the real
 * Composio request via the same pure `buildComposioRequest` the direct
 * transport uses, so the wire shape is identical either way. The user's
 * Composio API key travels ONLY in the `Authorization: Bearer <key>` header,
 * is never read from the body, and is never logged (or included in any
 * thrown error — failures below only ever include Composio's status code
 * and response body).
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
  // KNOWN LIMITATION: `gateAgentInbox` and this route both want the
  // Authorization header for two different secrets — the gate checks it
  // against FRAGMENT_INGRESS_TOKEN for non-localhost requests, while this
  // route needs it to carry the caller's Composio API key. They collide:
  // from a non-localhost Host, the header can only satisfy one of the two,
  // so in practice this route only works out of the box when the request's
  // Host is localhost/127.0.0.1 (the gate's no-token-required branch) —
  // i.e. self-hosting on the same machine you're publishing from. Remote
  // self-host deployments would need a real per-purpose auth scheme, which
  // is out of scope for this BYO-key spike; flagged for ARI-161 alongside
  // the hosted-build server-side implementation.
  if (!gate.allowed) {
    return new NextResponse(null, { status: 404 });
  }

  const authHeader = req.headers.get("authorization");
  const composioApiKey = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!composioApiKey) {
    return NextResponse.json({ error: "Missing Composio API key." }, { status: 401 });
  }

  let action: ComposioAction;
  try {
    action = (await req.json()) as ComposioAction;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!action || typeof action !== "object" || !("kind" in action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 400 });
  }

  const composioReq = buildComposioRequest(composioApiKey, action);

  let upstream: Response;
  try {
    upstream = await fetch(composioReq.url, {
      method: composioReq.method,
      headers: composioReq.headers,
      body: composioReq.body ? JSON.stringify(composioReq.body) : undefined,
    });
  } catch {
    return NextResponse.json({ error: "Couldn't reach Composio." }, { status: 502 });
  }

  const raw = await upstream.text();
  let body: unknown;
  try {
    body = raw ? JSON.parse(raw) : undefined;
  } catch {
    body = raw || undefined;
  }

  return NextResponse.json(body ?? {}, { status: upstream.status });
}
