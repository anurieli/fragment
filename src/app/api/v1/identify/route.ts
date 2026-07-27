import { NextRequest, NextResponse } from "next/server";

import { isDatabaseConfigured, query } from "@/lib/server/db";
import { getSessionUser } from "@/lib/server/session";

export const runtime = "nodejs";

/**
 * POST /api/v1/identify
 *
 * Records that an install exists and what it is. A device is not an account:
 * this fires before anyone signs in, which is the whole reason it is keyed on
 * a client-generated device id. When there is a session we attach the user id
 * too, so a device can later be traced to the person using it.
 *
 * Silently does nothing when no database is configured. Telemetry must never
 * be the reason a self-hosted app shows an error.
 */
export async function POST(req: NextRequest) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: true });

  let body: {
    deviceId?: string;
    name?: string;
    email?: string;
    platform?: string;
    appVersion?: string;
    writingTypes?: string[];
    role?: string;
    profileSource?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 400 });
  }

  if (!body.deviceId || typeof body.deviceId !== "string") {
    return NextResponse.json({ error: "Missing deviceId" }, { status: 400 });
  }

  const user = await getSessionUser();

  try {
    await query(
      `insert into devices (
         id, user_id, name, email, platform, app_version,
         writing_types, role, profile_source, last_seen_at
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
       on conflict (id) do update
         set user_id        = coalesce(excluded.user_id, devices.user_id),
             name           = coalesce(excluded.name, devices.name),
             email          = coalesce(excluded.email, devices.email),
             platform       = coalesce(excluded.platform, devices.platform),
             app_version    = coalesce(excluded.app_version, devices.app_version),
             writing_types  = coalesce(excluded.writing_types, devices.writing_types),
             role           = coalesce(excluded.role, devices.role),
             profile_source = coalesce(excluded.profile_source, devices.profile_source),
             last_seen_at   = now()`,
      [
        body.deviceId,
        user?.id ?? null,
        body.name ?? null,
        body.email ?? null,
        body.platform ?? null,
        body.appVersion ?? null,
        Array.isArray(body.writingTypes) ? body.writingTypes : null,
        body.role ?? null,
        body.profileSource ?? null,
      ],
    );
  } catch (err) {
    console.error("[identify] failed:", err);
    return NextResponse.json({ error: "Failed to record device" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
