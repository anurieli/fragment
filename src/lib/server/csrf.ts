import { NextResponse, type NextRequest } from "next/server";

/**
 * Cross-site guards for the state-changing cloud routes.
 *
 * The session cookie is SameSite=Lax, which stops a cross-site POST from
 * carrying an EXISTING session. It does nothing about the opposite attack:
 * a cross-site form that MINTS one. `POST /api/v1/auth/session` takes an
 * id_token and sets a cookie, so an attacker submitting their OWN valid
 * token from their own page logs the victim's browser into the ATTACKER's
 * account. The victim then writes into it, and worse, on first link the sync
 * engine calls `seedOutboxFromLocal` (src/lib/sync/engine.ts) and uploads
 * every note, idea and draft already on the device. That is the writer's
 * whole corpus walking into someone else's account, which for a writing app
 * is the worst thing that can happen short of losing it.
 *
 * Two independent barriers, either one sufficient on its own:
 *
 *   1. `Origin`, when present, must match this deployment. Browsers always
 *      send Origin on a cross-origin POST, form submissions included, so a
 *      mismatch is decisive. Absence means a non-browser caller (the Tauri
 *      desktop build, curl), which no attacker page can drive, so it passes.
 *   2. `Content-Type` must be JSON. A plain HTML form can only send
 *      text/plain, multipart/form-data or urlencoded, so requiring JSON
 *      blocks the text/plain body-smuggling trick that otherwise slips past
 *      a `req.json()` that never looks at the header.
 */

/** True when a browser sent this from an origin that is not ours. */
export function isCrossSite(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  // No Origin: not a browser cross-site request. Native clients omit it.
  if (!origin) return false;

  const host = req.headers.get("host");
  if (!host) return true;

  try {
    return new URL(origin).host !== host;
  } catch {
    // An Origin we cannot parse is not one we can vouch for.
    return true;
  }
}

/** True unless the body is declared as JSON. */
export function isNotJsonBody(req: NextRequest): boolean {
  const type = req.headers.get("content-type") ?? "";
  return !type.toLowerCase().split(";")[0].trim().startsWith("application/json");
}

export function crossSiteRefused(): NextResponse {
  return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
}

/**
 * The guard for a JSON route that changes state. Returns a response to send,
 * or null to continue.
 */
export function guardJsonMutation(req: NextRequest): NextResponse | null {
  if (isCrossSite(req)) return crossSiteRefused();
  if (isNotJsonBody(req)) {
    return NextResponse.json({ error: "Expected a JSON body" }, { status: 415 });
  }
  return null;
}
