/**
 * Platform-aware fetch for hosts the Tauri WKWebView can't reach directly.
 *
 * chatgpt.com/backend-api (Codex) rejects the WKWebView's CORS preflight
 * from the tauri://localhost origin with HTTP 400 "Disallowed CORS origin" —
 * no browser fetch() from that origin can ever succeed. Tauri's native HTTP
 * plugin issues the request from the Rust process instead, which isn't
 * subject to the WebView's CORS policy. Every other host, and every
 * non-Tauri build, keeps using the regular global fetch unchanged.
 *
 * Self-contained (no import from ai-client.ts) to avoid a circular import:
 * ai-client.ts is the caller of codexFetch.
 */

const CODEX_HOST = "chatgpt.com";

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function targetsCodex(input: RequestInfo | URL): boolean {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    return new URL(raw).hostname === CODEX_HOST;
  } catch {
    return false;
  }
}

/**
 * fetch() that routes chatgpt.com requests through Tauri's native HTTP
 * plugin when running inside Tauri, and falls through to global fetch
 * everywhere else (web/dev builds, or non-chatgpt.com URLs).
 */
export async function codexFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTauriRuntime() && targetsCodex(input)) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(input, init);
  }
  return fetch(input, init);
}
