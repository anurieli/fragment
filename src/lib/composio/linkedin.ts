// One-click "Publish to LinkedIn" via Composio — ARI-155.
//
// SPIKE FINDINGS (research done July 2026 against docs.composio.dev; no live
// Composio account was available to verify against a real response, so
// every response-shape assumption below is called out explicitly and this
// module is written defensively — see `parseAuthorUrn` / `parsePostResult`).
//
// 1. Auth flow: Composio's OLDER `connected_accounts.initiate()` /
//    `POST /connected_accounts` flow stopped working for Composio-managed
//    OAuth on ALL orgs as of 2026-07-03 (per Composio's own migration
//    guide). The CURRENT flow is the hosted "Connect Link" session:
//      POST https://backend.composio.dev/api/v3/connected_accounts/link
//      headers: { "x-api-key": <composio key>, "Content-Type": "application/json" }
//      body:    { toolkit: "linkedin", user_id: <fragment user id> }
//      response (assumed): { redirect_url, connected_account_id, id, status }
//    The user opens `redirect_url` in a browser tab to grant access; Composio
//    hosts the OAuth dance and the token storage entirely — Fragment never
//    sees a LinkedIn credential, only the resulting `connected_account_id`.
//
// 2. Status polling:
//      GET https://backend.composio.dev/api/v3/connected_accounts/{id}
//      headers: { "x-api-key": <composio key> }
//      response (assumed): { status: "INITIALIZING"|"INITIATED"|"ACTIVE"|
//        "EXPIRED"|"REVOKED"|"FAILED", toolkit: { slug }, alias?,
//        state?: { val?: { account_id, ... } } }
//    `alias` (if the user set one) or a derived label is the best
//    human-readable "connected as" string available without an extra call.
//
// 3. Publishing: Composio wraps LinkedIn's Posts API as two separate tools,
//    both executed via:
//      POST https://backend.composio.dev/api/v3/tools/execute/{TOOL_SLUG}
//      headers: { "x-api-key": <composio key>, "Content-Type": "application/json" }
//      body: { arguments: {...}, connected_account_id, user_id }
//    LinkedIn's create-post API requires an `author` LinkedIn member URN
//    (`urn:li:person:<id>`), which Composio does NOT appear to auto-resolve
//    from the connected account (per the toolkit's own tool list) — so this
//    module first calls `LINKEDIN_GET_MY_INFO` to resolve the URN, then
//    `LINKEDIN_CREATE_LINKED_IN_POST` with `{ commentary, author }`. This is
//    the one non-obvious, spike-driven design decision in this file: a
//    single "publish" call is actually two Composio tool executions.
//    A known, unrelated Composio bug (ComposioHQ/composio#3113) has this
//    tool intermittently fail with HTTP 426 because Composio's backend can
//    send a stale `LinkedIn-Version` header — surfaced here as a `kind:
//    "unknown"` `ComposioApiError` with the raw detail in the message so the
//    user isn't left guessing.
//
// 4. CORS / key exposure: `backend.composio.dev` does not reliably send
//    `Access-Control-Allow-Origin` for third-party origins (confirmed via a
//    public Composio CORS bug on their OWN dashboard domain), and Composio's
//    docs explicitly recommend a server-side proxy over calling from a
//    browser with a raw key. So: the browser/web build never calls
//    `backend.composio.dev` directly — it goes through the gated proxy route
//    `POST /api/v1/publish/linkedin` (see that route's doc comment). The
//    Tauri desktop build has no such route at all (static export, no
//    Next.js server) and Tauri's native HTTP plugin isn't subject to the
//    WebView's CORS policy, so it calls Composio directly — mirroring
//    `codexFetch`'s Tauri-vs-web split in `platform-fetch.ts`.
//
// The `ComposioTransport` seam below is exactly this pluggable half: the
// hosted SaaS build can swap in a fully server-side implementation later
// without touching call sites — see ARI-161.

import { isTauri } from "@/lib/ai-client";
import { escapeLinkedInReserved } from "@/lib/publish/linkedin";
import { LINKEDIN_CHAR_LIMIT, charCount } from "@/lib/publish/limits";

export const COMPOSIO_API_BASE = "https://backend.composio.dev/api/v3";
export const LINKEDIN_TOOLKIT_SLUG = "linkedin";
export const LINKEDIN_GET_MY_INFO_TOOL = "LINKEDIN_GET_MY_INFO";
export const LINKEDIN_CREATE_POST_TOOL = "LINKEDIN_CREATE_LINKED_IN_POST";

// Fragment is local-first / single-user per install; Composio's `user_id`
// just needs to be a stable, non-empty string scoping the connection to
// "this install". There's no multi-tenant account system to key off of yet.
export const FRAGMENT_COMPOSIO_USER_ID = "fragment-local-user";

// The proxy route this module's non-Tauri transport calls — see
// src/app/api/v1/publish/linkedin/route.ts.
const PROXY_ROUTE = "/api/v1/publish/linkedin";

// ---------------------------------------------------------------------------
// Request shapes — the three Composio calls this feature needs, expressed as
// a discriminated union so one dispatcher (`buildComposioRequest`) is the
// single source of truth for URL/method/body construction. Both transports
// (direct-from-Tauri and the server-side proxy route) call this same
// dispatcher, so there is exactly one place that knows Composio's REST shape.
// ---------------------------------------------------------------------------

export type ComposioAction =
  | { kind: "link"; userId: string }
  | { kind: "status"; connectedAccountId: string }
  | {
      kind: "execute";
      toolSlug: string;
      connectedAccountId: string;
      userId: string;
      arguments: Record<string, unknown>;
    };

export interface ComposioApiRequest {
  method: "GET" | "POST";
  url: string;
  headers: Record<string, string>;
  body?: Record<string, unknown>;
}

/**
 * Pure dispatcher: `ComposioAction` -> the exact HTTP request Composio
 * expects. No network access, so every action shape is unit-testable
 * directly. `apiKey` is the user's own Composio API key (BYO, never
 * Fragment's).
 */
export function buildComposioRequest(apiKey: string, action: ComposioAction): ComposioApiRequest {
  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };

  switch (action.kind) {
    case "link":
      return {
        method: "POST",
        url: `${COMPOSIO_API_BASE}/connected_accounts/link`,
        headers,
        body: { toolkit: LINKEDIN_TOOLKIT_SLUG, user_id: action.userId },
      };
    case "status":
      return {
        method: "GET",
        url: `${COMPOSIO_API_BASE}/connected_accounts/${encodeURIComponent(action.connectedAccountId)}`,
        headers,
      };
    case "execute":
      return {
        method: "POST",
        url: `${COMPOSIO_API_BASE}/tools/execute/${encodeURIComponent(action.toolSlug)}`,
        headers,
        body: {
          arguments: action.arguments,
          connected_account_id: action.connectedAccountId,
          user_id: action.userId,
        },
      };
  }
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export type ComposioErrorKind =
  | "invalid_key"
  | "connection_expired"
  | "connection_revoked"
  | "rate_limited"
  | "over_limit"
  | "validation"
  | "network"
  | "unknown";

export class ComposioApiError extends Error {
  readonly status: number;
  readonly kind: ComposioErrorKind;

  constructor(message: string, status: number, kind: ComposioErrorKind) {
    super(message);
    this.name = "ComposioApiError";
    this.status = status;
    this.kind = kind;
  }
}

function extractComposioErrorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const root = body as Record<string, unknown>;
  const err = root.error && typeof root.error === "object" ? (root.error as Record<string, unknown>) : root;
  if (typeof err.message === "string" && err.message.trim()) return err.message.trim();
  if (Array.isArray(err.errors) && err.errors.length > 0) {
    const messages = err.errors.filter((m): m is string => typeof m === "string" && m.trim().length > 0);
    if (messages.length > 0) return messages.join("; ");
  }
  return undefined;
}

/**
 * Pure status/body -> error-kind mapping. A 401/403 is ambiguous between
 * "bad API key" and "the LinkedIn connection expired/was revoked" — Composio
 * doesn't appear to use a distinct HTTP status for the latter, so this
 * inspects the error detail text for expiry/revocation language before
 * falling back to `invalid_key`. Exported for direct unit testing.
 */
export function composioErrorKind(status: number, body: unknown): ComposioErrorKind {
  const detail = extractComposioErrorDetail(body) ?? "";
  if (/revoked/i.test(detail)) return "connection_revoked";
  if (/expired|reconnect|re-?authenticate/i.test(detail)) return "connection_expired";
  if (status === 401 || status === 403) return "invalid_key";
  if (status === 429) return "rate_limited";
  if (status === 422) return "validation";
  return "unknown";
}

/** Pure status/body -> readable, toast-safe message. */
export function composioErrorMessage(status: number, body: unknown): string {
  const detail = extractComposioErrorDetail(body);
  switch (composioErrorKind(status, body)) {
    case "connection_expired":
      return "Your LinkedIn connection expired — reconnect it in Settings → Integrations.";
    case "connection_revoked":
      return "Your LinkedIn connection was revoked — reconnect it in Settings → Integrations.";
    case "invalid_key":
      return "Composio rejected your API key — check your Composio API key in Settings → Integrations.";
    case "rate_limited":
      return "Composio's rate limit was hit — try again in a moment.";
    case "validation":
      return detail ? `LinkedIn rejected the post: ${detail}` : "LinkedIn rejected the post — check its content.";
    default:
      return detail ? `Composio error: ${detail}` : `Composio request failed (HTTP ${status}).`;
  }
}

// ---------------------------------------------------------------------------
// Transport — direct (Tauri only) vs. gated server-side proxy (everywhere
// else). See the file-level doc comment for why: no reliable CORS from
// backend.composio.dev, and Composio's own guidance against a raw key in
// browser code.
// ---------------------------------------------------------------------------

export interface ComposioTransportResult {
  status: number;
  body: unknown;
}

export type ComposioTransport = (apiKey: string, action: ComposioAction) => Promise<ComposioTransportResult>;

async function parseJsonResponse(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Calls Composio directly. Only ever selected when running inside Tauri
 * (see `getDefaultComposioTransport`) — Tauri's native HTTP plugin isn't
 * subject to the WebView's CORS policy, the same reason `codexFetch` in
 * `platform-fetch.ts` routes chatgpt.com calls through it. Duplicated here
 * (rather than importing `codexFetch`, which is scoped to a single host)
 * to keep this module self-contained and host-agnostic.
 */
export const directComposioTransport: ComposioTransport = async (apiKey, action) => {
  const req = buildComposioRequest(apiKey, action);
  let response: Response;
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    response = await tauriFetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
  } else {
    response = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
    });
  }
  return { status: response.status, body: await parseJsonResponse(response) };
};

/**
 * Forwards the action to Fragment's own gated proxy route (see
 * src/app/api/v1/publish/linkedin/route.ts), which reconstructs the exact
 * same request via `buildComposioRequest` server-side — so the wire shape
 * Composio sees is identical either way. The Composio API key travels only
 * in the `Authorization` header, never in the JSON body, and the route
 * never logs it.
 */
export const proxyComposioTransport: ComposioTransport = async (apiKey, action) => {
  const response = await fetch(PROXY_ROUTE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(action),
  });
  return { status: response.status, body: await parseJsonResponse(response) };
};

/** Tauri (direct, no server) vs. every other build (gated proxy route). */
export function getDefaultComposioTransport(): ComposioTransport {
  return isTauri() ? directComposioTransport : proxyComposioTransport;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InitiateLinkedInConnectionResult {
  redirectUrl: string;
  connectedAccountId: string;
}

export type LinkedInConnectionStatus =
  | "initiated"
  | "active"
  | "expired"
  | "revoked"
  | "failed"
  | "unknown";

export interface LinkedInConnectionStatusResult {
  status: LinkedInConnectionStatus;
  accountLabel?: string;
}

export interface PublishLinkedInPostResult {
  url?: string;
  externalId?: string;
}

async function runComposioAction(
  apiKey: string,
  action: ComposioAction,
  transport: ComposioTransport,
): Promise<unknown> {
  let result: ComposioTransportResult;
  try {
    result = await transport(apiKey, action);
  } catch {
    throw new ComposioApiError("Couldn't reach Composio — check your connection and try again.", 0, "network");
  }
  if (result.status < 200 || result.status >= 300) {
    throw new ComposioApiError(
      composioErrorMessage(result.status, result.body),
      result.status,
      composioErrorKind(result.status, result.body),
    );
  }
  return result.body;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

/**
 * Starts a Composio "Connect Link" session for the LinkedIn toolkit. The
 * caller opens `redirectUrl` (a new tab — Composio hosts the OAuth grant
 * page) and polls `getConnectionStatus(apiKey, connectedAccountId)` until it
 * reports `"active"`.
 */
export async function initiateLinkedInConnection(
  composioApiKey: string,
  transport: ComposioTransport = getDefaultComposioTransport(),
): Promise<InitiateLinkedInConnectionResult> {
  const body = await runComposioAction(
    composioApiKey,
    { kind: "link", userId: FRAGMENT_COMPOSIO_USER_ID },
    transport,
  );
  const root = asRecord(body);
  const redirectUrl =
    (typeof root?.redirect_url === "string" && root.redirect_url) ||
    (typeof root?.redirectUrl === "string" && root.redirectUrl) ||
    undefined;
  const connectedAccountId =
    (typeof root?.connected_account_id === "string" && root.connected_account_id) ||
    (typeof root?.id === "string" && root.id) ||
    undefined;
  if (!redirectUrl || !connectedAccountId) {
    throw new ComposioApiError(
      "Composio didn't return a connection link — try again in a moment.",
      0,
      "unknown",
    );
  }
  return { redirectUrl, connectedAccountId };
}

function normalizeConnectionStatus(raw: unknown): LinkedInConnectionStatus {
  if (typeof raw !== "string") return "unknown";
  switch (raw.toUpperCase()) {
    case "ACTIVE":
      return "active";
    case "INITIALIZING":
    case "INITIATED":
      return "initiated";
    case "EXPIRED":
      return "expired";
    case "REVOKED":
      return "revoked";
    case "FAILED":
      return "failed";
    default:
      return "unknown";
  }
}

function extractAccountLabel(root: Record<string, unknown> | undefined): string | undefined {
  if (!root) return undefined;
  if (typeof root.alias === "string" && root.alias.trim()) return root.alias.trim();
  const state = asRecord(root.state);
  const val = asRecord(state?.val);
  if (typeof val?.account_id === "string" && val.account_id.trim()) return val.account_id.trim();
  if (typeof root.word_id === "string" && root.word_id.trim()) return root.word_id.trim();
  return undefined;
}

/** Polls a single Composio connected-account status check. */
export async function getConnectionStatus(
  composioApiKey: string,
  connectedAccountId: string,
  transport: ComposioTransport = getDefaultComposioTransport(),
): Promise<LinkedInConnectionStatusResult> {
  const body = await runComposioAction(composioApiKey, { kind: "status", connectedAccountId }, transport);
  const root = asRecord(body);
  return {
    status: normalizeConnectionStatus(root?.status),
    accountLabel: extractAccountLabel(root),
  };
}

/**
 * Resolves the connected LinkedIn member's URN via `LINKEDIN_GET_MY_INFO`.
 * ASSUMPTION (unverified — no live Composio account available): the
 * response carries the member id somewhere under `data`, either already as
 * a full `urn:li:person:...` URN or as a bare id that needs the prefix
 * added. Both shapes are handled; if neither is found the caller gets a
 * clear `ComposioApiError` rather than silently posting with a bad author.
 */
async function resolveAuthorUrn(
  composioApiKey: string,
  connectedAccountId: string,
  transport: ComposioTransport,
): Promise<string> {
  const body = await runComposioAction(
    composioApiKey,
    {
      kind: "execute",
      toolSlug: LINKEDIN_GET_MY_INFO_TOOL,
      connectedAccountId,
      userId: FRAGMENT_COMPOSIO_USER_ID,
      arguments: {},
    },
    transport,
  );
  const root = asRecord(body);
  const data = asRecord(root?.data) ?? root;
  const candidate =
    (typeof data?.author === "string" && data.author) ||
    (typeof data?.urn === "string" && data.urn) ||
    (typeof data?.id === "string" && data.id) ||
    (typeof data?.sub === "string" && data.sub) ||
    undefined;
  if (!candidate) {
    throw new ComposioApiError(
      "Couldn't resolve your LinkedIn account details — try reconnecting in Settings → Integrations.",
      0,
      "unknown",
    );
  }
  return candidate.startsWith("urn:") ? candidate : `urn:li:person:${candidate}`;
}

/**
 * Best-effort LinkedIn post URL from a post URN
 * (`urn:li:share:...` / `urn:li:ugcPost:...`). LinkedIn does not document
 * this as a stable link the way it documents the URN itself — same caveat
 * as `kitBroadcastEditUrl` in kit.ts — so treat it as a convenience, not a
 * guarantee.
 */
function deriveLinkedInPostUrl(externalId: string | undefined): string | undefined {
  if (!externalId) return undefined;
  return `https://www.linkedin.com/feed/update/${encodeURIComponent(externalId)}/`;
}

/**
 * Publishes `text` to LinkedIn via Composio: escapes LinkedIn's reserved
 * "little text" characters, enforces the 3000-character limit as a
 * pre-flight check (throws before any network call if over), resolves the
 * author URN, then executes the create-post tool. Throws `ComposioApiError`
 * on any failure, with a message already safe to show a user.
 */
export async function publishLinkedInPost(
  composioApiKey: string,
  connectedAccountId: string,
  text: string,
  transport: ComposioTransport = getDefaultComposioTransport(),
): Promise<PublishLinkedInPostResult> {
  const escaped = escapeLinkedInReserved(text);
  if (charCount(escaped) > LINKEDIN_CHAR_LIMIT) {
    throw new ComposioApiError(
      `This post is over LinkedIn's ${LINKEDIN_CHAR_LIMIT}-character limit.`,
      0,
      "over_limit",
    );
  }

  const author = await resolveAuthorUrn(composioApiKey, connectedAccountId, transport);

  const body = await runComposioAction(
    composioApiKey,
    {
      kind: "execute",
      toolSlug: LINKEDIN_CREATE_POST_TOOL,
      connectedAccountId,
      userId: FRAGMENT_COMPOSIO_USER_ID,
      arguments: { commentary: escaped, author },
    },
    transport,
  );
  const root = asRecord(body);
  const data = asRecord(root?.data) ?? root;
  const externalId =
    (typeof data?.id === "string" && data.id) ||
    (typeof data?.urn === "string" && data.urn) ||
    (typeof data?.postUrn === "string" && data.postUrn) ||
    undefined;
  const url =
    (typeof data?.url === "string" && data.url) ||
    deriveLinkedInPostUrl(externalId);

  return { url, externalId };
}

// ---------------------------------------------------------------------------
// Share-menu eligibility gating — pure, mirrors `canPublishToKit` in kit.ts.
// ---------------------------------------------------------------------------

/**
 * True once both the Composio API key and a stored connected-account id are
 * present (non-blank). This does NOT re-check live connection status — an
 * expired/revoked connection still passes this gate and surfaces its error
 * at publish time via `ComposioApiError`'s `connection_expired` /
 * `connection_revoked` kind, same as Kit's key-presence-only gate.
 */
export function canPublishToLinkedIn(
  composioApiKey: string | undefined,
  connectedAccountId: string | undefined,
): boolean {
  return Boolean(composioApiKey?.trim()) && Boolean(connectedAccountId?.trim());
}
