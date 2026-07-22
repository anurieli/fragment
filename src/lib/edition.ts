/**
 * Deployment edition.
 *
 * Fragment ships as one codebase in two shapes:
 *   - "hosted"     — the managed SaaS. AI is included (powered by our OpenRouter
 *                    key on the server), so it works with zero configuration.
 *                    Users may still bring their own keys for any provider.
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
