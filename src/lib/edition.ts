/**
 * Deployment edition.
 *
 * Fragment ships as one codebase in two shapes:
 *   - "hosted"     — the web SaaS with accounts and opt-in cloud sync. Hosting
 *                    alone does not grant AI access; users connect a provider.
 *   - "self-host"  — open source / desktop. There is no managed AI; users bring
 *                    their own provider keys (or run Ollama locally). This is the
 *                    default when the flag is unset.
 *
 * Set NEXT_PUBLIC_FRAGMENT_HOSTED=true at build time for the hosted SaaS.
 */

export type Edition = "hosted" | "self-host";

export function getEdition(): Edition {
  return process.env.NEXT_PUBLIC_FRAGMENT_HOSTED === "true" ? "hosted" : "self-host";
}

/** True in the managed hosted SaaS build. */
export function isHosted(): boolean {
  return getEdition() === "hosted";
}
