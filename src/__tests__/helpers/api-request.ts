/**
 * Request doubles for the `/api/*` route handler tests.
 *
 * The AI routes run their guards before they ever touch the body: both
 * `getClientIp` and `bodyTooLarge` read `req.headers`. A bare
 * `{ json: () => ... }` object is therefore not a usable stand-in for a
 * `NextRequest`; it makes the handler throw on `headers.get` before any of
 * the behaviour under test runs. Giving the double a real `Headers` instance
 * keeps the guards on the same code path they take in production, so a test
 * exercises the whole handler rather than a truncated version of it.
 */

export interface ApiRequestDouble {
  json: () => Promise<unknown>;
  headers: Headers;
}

/** Loopback-documentation address; any stable value works as a rate-limit key. */
const DEFAULT_CLIENT_IP = "203.0.113.1";

/**
 * Build a request double carrying `body` as its JSON payload.
 *
 * `headers` overrides or adds to the defaults, which is how a test drives the
 * guards themselves: pass `content-length` to trigger the payload cap, or a
 * distinct `x-forwarded-for` to get a fresh rate-limit bucket.
 */
export function makeApiRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): ApiRequestDouble {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers({ "x-forwarded-for": DEFAULT_CLIENT_IP, ...headers }),
  };
}
