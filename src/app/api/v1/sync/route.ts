import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";
import { applySync } from "@/lib/server/sync-store";
import { parseSyncRequest } from "@/lib/sync/protocol";

export const runtime = "nodejs";

/**
 * POST /api/v1/sync
 *
 * Push local changes and pull everything this client has not seen, in one
 * round trip. Body is a SyncRequest; the reply is a SyncResponse. See
 * src/lib/sync/protocol.ts for the contract and why it works this way.
 *
 * Every row read or written is scoped to the session's user id, which is
 * taken from the session cookie and never from the request body. There is no
 * parameter by which a caller can name whose documents to touch.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "This Fragment build has no cloud configured." },
      { status: 503 },
    );
  }

  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  const parsed = parseSyncRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await applySync(user.id, parsed.value.cursor, parsed.value.changes);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[sync] failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
