/**
 * Local ingress gate for the agent-inbox routes.
 *
 * The agent-inbox routes read the local filesystem (`~/.fragment/inbox` by
 * default), which is only safe to expose when:
 *   1. this is NOT the hosted SaaS build (local ingress is a self-host-only
 *      / desktop feature — the hosted build has no local filesystem to read),
 *   2. the operator has explicitly opted in via FRAGMENT_LOCAL_INGRESS=true
 *      (off by default), and
 *   3. requests that don't arrive over localhost carry the exact bearer
 *      token configured via FRAGMENT_INGRESS_TOKEN.
 *
 * This function is pure — it takes already-resolved env values rather than
 * reading `process.env` itself — so the gate matrix can be unit tested
 * without stubbing globals or touching Next.js request objects. Callers
 * (the route handlers) resolve the env values and the request's Host /
 * Authorization headers, then pass them in here.
 *
 * Any failure mode returns `{ allowed: false }`; the route then responds
 * 404 (never 401/403) so the endpoint's existence isn't revealed when the
 * gate is closed.
 */

export interface AgentInboxGateEnv {
  /** True in the managed hosted SaaS build (see `src/lib/edition.ts`). */
  isHosted: boolean;
  /** True iff `process.env.FRAGMENT_LOCAL_INGRESS === "true"`. */
  localIngressEnabled: boolean;
  /** `process.env.FRAGMENT_INGRESS_TOKEN`, if configured. */
  ingressToken: string | undefined;
}

export interface AgentInboxGateResult {
  allowed: boolean;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function normalizeHostname(host: string | null | undefined): string {
  if (!host) return "";
  // `Host` headers may carry a port (e.g. "localhost:3100" or "[::1]:3100").
  // Strip it without breaking IPv6 bracket notation.
  const trimmed = host.trim().toLowerCase();
  if (trimmed.startsWith("[")) {
    const closeBracket = trimmed.indexOf("]");
    return closeBracket === -1 ? trimmed : trimmed.slice(0, closeBracket + 1);
  }
  const lastColon = trimmed.lastIndexOf(":");
  return lastColon === -1 ? trimmed : trimmed.slice(0, lastColon);
}

function isLocalHost(host: string | null | undefined): boolean {
  return LOCAL_HOSTNAMES.has(normalizeHostname(host));
}

/**
 * Decide whether an agent-inbox request is allowed through the gate.
 *
 * Matrix:
 *   - hosted build                          → closed, always
 *   - FRAGMENT_LOCAL_INGRESS unset/not "true" → closed, always
 *   - request Host is localhost/127.0.0.1/::1 → open, no token required
 *   - any other Host                        → open only with an exact
 *                                              `Authorization: Bearer <token>`
 *                                              match against ingressToken;
 *                                              closed if the token is unset
 */
export function gateAgentInbox(
  env: AgentInboxGateEnv,
  host: string | null | undefined,
  authHeader: string | null | undefined,
): AgentInboxGateResult {
  if (env.isHosted) return { allowed: false };
  if (!env.localIngressEnabled) return { allowed: false };
  if (isLocalHost(host)) return { allowed: true };
  if (!env.ingressToken) return { allowed: false };
  return { allowed: authHeader === `Bearer ${env.ingressToken}` };
}
