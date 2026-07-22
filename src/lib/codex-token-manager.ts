/**
 * Centralized Codex ("Sign in with ChatGPT") token lifecycle.
 *
 * Production design goals, matching how the official Codex CLI and robust
 * third-party clients (OpenCode, etc.) keep a ChatGPT OAuth session alive:
 *
 * 1. Proactive refresh — refresh before the access token expires (5-min
 *    buffer), so a session almost never lapses mid-use.
 * 2. Single-flight — concurrent callers share one refresh round-trip, so we
 *    never burn the single-use refresh token twice in parallel.
 * 3. Resilient — a TRANSIENT failure (network down, 5xx, 429, malformed body)
 *    NEVER clears credentials. Only a DEFINITIVE rejection of the refresh
 *    token (4xx `invalid_grant`) ends the session. This is the single most
 *    important fix: previously any failed refresh wiped both tokens and forced
 *    a full re-login.
 * 4. Self-owned session — Fragment owns its own refresh token and does NOT
 *    read or write ~/.codex/auth.json. A refresh token is single-use and
 *    rotates on every refresh; sharing one file across Fragment AND the Codex
 *    CLI meant whichever process refreshed first invalidated the other,
 *    which was a primary cause of random "ChatGPT disconnected" logouts.
 *
 * Connection status is mirrored into the app store; a transition to
 * "disconnected" also marks codex bad and opens the AI connect gate (see
 * ConnectGate), which is the one-click reconnect affordance.
 */

import { postCodexToken } from "./ai-client";
import { useAppStore } from "@/stores/app-store";

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The most recent refresh token we know about (from settings or a refresh). */
let latestRefreshToken = "";

/** In-flight refresh promise. Concurrent callers await the same one. */
let activeRefresh: Promise<RefreshOutcome> | null = null;

/**
 * Bumped by clearCodexSession(). A refresh that was already in flight when
 * the user disconnected must NOT write its tokens back into the store;
 * that would silently resurrect the session the user just ended.
 */
let sessionEpoch = 0;

type CredentialUpdater = (creds: {
  codexAccessToken: string;
  codexRefreshToken: string;
}) => void;

/**
 * The result of a refresh attempt.
 * - `ok`        — got fresh tokens.
 * - `dead`      — the refresh token was definitively rejected; re-auth needed.
 * - `transient` — couldn't refresh right now (network/server); keep tokens.
 */
type RefreshOutcome =
  | { kind: "ok"; accessToken: string; refreshToken: string }
  | { kind: "dead" }
  | { kind: "transient" };

/** Refresh this far ahead of expiry so tokens rarely lapse during use. */
const REFRESH_BUFFER_MS = 5 * 60_000;

/** Retries for transient refresh failures before giving up (without wiping). */
const MAX_TRANSIENT_RETRIES = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(status: "connected" | "refreshing" | "disconnected"): void {
  try {
    const app = useAppStore.getState();
    app.setCodexConnection(status);
    // Definitive disconnect (refresh token dead / missing) — generalize the
    // old Codex-only reconnect banner into the shared AI connect gate.
    if (status === "disconnected") {
      app.markProviderBad("codex");
      app.openAiGate("auth-failed", "codex");
    }
  } catch {
    /* store not available (e.g. SSR) — status is best-effort */
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Parse the `exp` claim from a JWT. Returns ms timestamp, or 0 on failure. */
function jwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const { exp } = JSON.parse(json) as { exp?: number };
    return typeof exp === "number" ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** True when the token is missing, unparseable, or expires within `bufferMs`. */
function isExpired(token: string | undefined, bufferMs = REFRESH_BUFFER_MS): boolean {
  if (!token) return true;
  const exp = jwtExpiry(token);
  return exp === 0 || Date.now() + bufferMs >= exp;
}

// ---------------------------------------------------------------------------
// Refresh (mutex-guarded, retry-on-transient, never-wipe-on-transient)
// ---------------------------------------------------------------------------

async function attemptRefresh(refreshToken: string): Promise<RefreshOutcome> {
  let res: Response;
  try {
    res = await postCodexToken(JSON.stringify({ refreshToken }));
  } catch {
    return { kind: "transient" };
  }

  if (res.ok) {
    try {
      const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (data.accessToken) {
        return {
          kind: "ok",
          accessToken: data.accessToken,
          // Refresh tokens rotate; keep the old one only if none was returned.
          refreshToken: data.refreshToken || refreshToken,
        };
      }
    } catch {
      /* fall through to transient — a 200 with a bad body is not a dead grant */
    }
    return { kind: "transient" };
  }

  // 429 / 5xx / network-proxy errors are transient — do NOT end the session.
  if (res.status === 429 || res.status >= 500 || res.status === 0) {
    return { kind: "transient" };
  }
  // A 4xx (invalid_grant / invalid_request / unauthorized) means the refresh
  // token is truly dead — only then do we require re-authentication.
  if (res.status >= 400) {
    return { kind: "dead" };
  }
  return { kind: "transient" };
}

async function refreshWithRetry(refreshToken: string): Promise<RefreshOutcome> {
  let outcome: RefreshOutcome = { kind: "transient" };
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    outcome = await attemptRefresh(refreshToken);
    if (outcome.kind !== "transient") return outcome;
    if (attempt < MAX_TRANSIENT_RETRIES) await delay(500 * (attempt + 1));
  }
  return outcome;
}

/**
 * Refresh, guarded by a mutex so concurrent callers share one round-trip.
 * Updates credentials + connection status according to the outcome.
 */
async function runRefresh(
  refreshToken: string,
  onUpdate: CredentialUpdater,
): Promise<RefreshOutcome> {
  if (!refreshToken) {
    onUpdate({ codexAccessToken: "", codexRefreshToken: "" });
    latestRefreshToken = "";
    setStatus("disconnected");
    return { kind: "dead" };
  }

  // Piggyback on an in-flight refresh.
  if (activeRefresh) return activeRefresh;

  const epochAtStart = sessionEpoch;
  setStatus("refreshing");
  activeRefresh = refreshWithRetry(refreshToken);

  try {
    const outcome = await activeRefresh;

    // The user disconnected while this refresh was in flight: discard the
    // result instead of writing tokens back and resurrecting the session.
    if (sessionEpoch !== epochAtStart) {
      return { kind: "dead" };
    }

    if (outcome.kind === "ok") {
      onUpdate({
        codexAccessToken: outcome.accessToken,
        codexRefreshToken: outcome.refreshToken,
      });
      latestRefreshToken = outcome.refreshToken;
      setStatus("connected");
    } else if (outcome.kind === "dead") {
      onUpdate({ codexAccessToken: "", codexRefreshToken: "" });
      latestRefreshToken = "";
      setStatus("disconnected");
    } else {
      // Transient: keep credentials untouched. Assume still connected; the
      // pending request may still succeed, and the next check will retry.
      setStatus("connected");
    }

    return outcome;
  } finally {
    activeRefresh = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get a valid Codex access token, proactively refreshing if it's expired or
 * expiring soon.
 *
 * Returns:
 * - a valid access token on success,
 * - the stored (possibly-stale) token on a transient refresh failure, so the
 *   caller's request can still proceed and surface a normal error rather than
 *   a spurious "disconnected",
 * - `null` ONLY when the session is definitively dead (re-auth required).
 */
export async function ensureValidCodexToken(
  storedAccess: string,
  storedRefresh: string,
  onUpdate: CredentialUpdater,
): Promise<string | null> {
  // Both stored tokens empty means the user is signed out (fresh install or
  // explicit disconnect). The store is the source of truth for that state:
  // never fall back to the module-level refresh token here, or a disconnect
  // would auto-reconnect on the next AI call.
  if (!storedAccess && !storedRefresh) return null;

  if (storedRefresh) latestRefreshToken = storedRefresh;

  // Stored token still valid? Use it.
  if (storedAccess && !isExpired(storedAccess)) {
    setStatus("connected");
    return storedAccess;
  }

  const outcome = await runRefresh(latestRefreshToken, onUpdate);
  if (outcome.kind === "ok") return outcome.accessToken;
  if (outcome.kind === "dead") return null;
  // Transient — let the request try with whatever token we have.
  return storedAccess || null;
}

/**
 * Force a refresh after a 401 (token invalidated between validation and use).
 * Returns the new token, or `null` if the session is dead / unreachable.
 */
export async function forceRefreshCodexToken(
  onUpdate: CredentialUpdater,
): Promise<string | null> {
  const outcome = await runRefresh(latestRefreshToken, onUpdate);
  return outcome.kind === "ok" ? outcome.accessToken : null;
}

/** Seed the manager's known refresh token (e.g. right after a fresh login). */
export function primeCodexRefreshToken(refreshToken: string): void {
  if (refreshToken) latestRefreshToken = refreshToken;
}

/**
 * End the Codex session on user-initiated disconnect. Clears the module-level
 * refresh token (so no later call can silently re-authenticate with it) and
 * invalidates any refresh already in flight (so its result is discarded
 * instead of being written back into the store). The caller is responsible
 * for clearing the persisted credentials.
 */
export function clearCodexSession(): void {
  latestRefreshToken = "";
  sessionEpoch++;
}
