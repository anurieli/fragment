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
  /**
   * Hostnames (no port) the operator trusts like localhost, from
   * `parseAllowedHosts(process.env.FRAGMENT_INGRESS_ALLOWED_HOSTS)`. For
   * self-hosters who reach their own instance through a reverse proxy or
   * private-network name (a tailnet/VPN hostname, a LAN name): the browser's
   * requests then carry that Host, not localhost, and the app's own inbox
   * polling can't attach a bearer token. Only list hosts that are private to
   * you — a Host header is caller-controlled, so this is trust in the
   * network path, not authentication.
   */
  allowedHosts?: readonly string[];
}

/**
 * Parse the comma-separated FRAGMENT_INGRESS_ALLOWED_HOSTS value into
 * normalized hostnames (lowercased, ports stripped). Unset/empty → [].
 */
export function parseAllowedHosts(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((h) => normalizeHostname(h))
    .filter((h) => h.length > 0);
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
 *   - request Host is in allowedHosts       → open, no token required
 *   - request Host is localhost/127.0.0.1/::1 → open, no token required,
 *                                              but ONLY when no allowedHosts
 *                                              list is configured (see below)
 *   - any other Host                        → open only with an exact
 *                                              `Authorization: Bearer <token>`
 *                                              match against ingressToken;
 *                                              closed if the token is unset
 *
 * The `Host` header is supplied by the caller and is not evidence of where a
 * request came from: anyone who can reach the server can send
 * `Host: localhost`. Trusting it unconditionally meant a deployment reachable
 * beyond the loopback (the tailnet instance, say) handed its inbox, its
 * filesystem-writing ack route and its outbound fetches to any peer that
 * asked in the right shape.
 *
 * So the localhost shortcut now only applies when the operator has NOT named
 * the hosts they expect. Setting FRAGMENT_INGRESS_ALLOWED_HOSTS is read as a
 * statement that the deployment is reachable by name, and from that point the
 * list is exhaustive: a bare `npm run dev` on a laptop still works with no
 * configuration, and a named deployment stops accepting a forged Host.
 */
export function gateAgentInbox(
  env: AgentInboxGateEnv,
  host: string | null | undefined,
  authHeader: string | null | undefined,
): AgentInboxGateResult {
  if (env.isHosted) return { allowed: false };
  if (!env.localIngressEnabled) return { allowed: false };

  const hasAllowList = Boolean(env.allowedHosts && env.allowedHosts.length > 0);
  if (hasAllowList && env.allowedHosts!.includes(normalizeHostname(host))) {
    return { allowed: true };
  }
  if (!hasAllowList && isLocalHost(host)) return { allowed: true };

  if (!env.ingressToken) return { allowed: false };
  return { allowed: authHeader === `Bearer ${env.ingressToken}` };
}
