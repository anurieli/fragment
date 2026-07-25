import { NextRequest, NextResponse } from "next/server";

import { isHosted } from "@/lib/edition";
import { gateAgentInbox } from "@/lib/agent-inbox/gate";
import { isValidFeedHost } from "@/lib/publish/substack-verify";

// Fetches an external host — never runs on the edge runtime, same posture
// as the agent-inbox routes.
export const runtime = "nodejs";

/**
 * GET /api/v1/rss-proxy?pub=<publication host>
 *
 * Local-ingress-only, gated identically to the agent-inbox routes (see
 * `gateAgentInbox` in `src/lib/agent-inbox/gate.ts`): 404 on the hosted
 * build, 404 unless `FRAGMENT_LOCAL_INGRESS=true`, and 404 to non-localhost
 * requests without the exact `FRAGMENT_INGRESS_TOKEN` bearer token. This
 * route exists purely to route around browser CORS when
 * `use-publish-verification.ts` polls a Substack RSS feed for a title
 * match — it never accepts a client-supplied full URL, only a bare `pub`
 * host that `isValidFeedHost` validates by shape (self-hosted Substacks run
 * on arbitrary custom domains, so there's no fixed allowlist to check
 * against — see that function's doc comment for exactly what's rejected).
 * Tauri builds skip this route entirely and fetch the feed directly (see
 * `use-publish-verification.ts`), since the static-export desktop build has
 * no Next.js server for this route to run on.
 */
export async function GET(req: NextRequest) {
  const gate = gateAgentInbox(
    {
      isHosted: isHosted(),
      localIngressEnabled: process.env.FRAGMENT_LOCAL_INGRESS === "true",
      ingressToken: process.env.FRAGMENT_INGRESS_TOKEN,
    },
    req.headers.get("host"),
    req.headers.get("authorization"),
  );
  if (!gate.allowed) {
    return new NextResponse(null, { status: 404 });
  }

  const pub = req.nextUrl.searchParams.get("pub");
  if (!pub || !isValidFeedHost(pub)) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const res = await fetch(`https://${pub}/feed`, {
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      redirect: "follow",
    });
    if (!res.ok) {
      return NextResponse.json({ error: "feed fetch failed" }, { status: 502 });
    }
    const xml = await res.text();
    return new NextResponse(xml, {
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  } catch {
    return NextResponse.json({ error: "feed fetch failed" }, { status: 502 });
  }
}
