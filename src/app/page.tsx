import { cookies } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { LandingPage } from "@/components/landing/landing-page";
import { isHosted } from "@/lib/edition";
import { SESSION_COOKIE } from "@/lib/server/session";

/**
 * The front door.
 *
 * Self-host and desktop builds go straight to the app: the person already
 * chose Fragment, a brochure would be in the way. The hosted edition shows
 * the landing page exactly once, to visitors who have neither entered the
 * app before (`fragment_entered`) nor signed in (`fragment_session`).
 *
 * Only cookie PRESENCE is checked here, not validity. Routing on presence
 * costs no database lookup, and a stale session cookie still means "this
 * person knows the app"; the client validates the session itself once loaded.
 */
export default async function Home() {
  if (!isHosted()) return <AppShell />;

  const jar = await cookies();
  if (jar.get("fragment_entered") || jar.get(SESSION_COOKIE)) return <AppShell />;

  return <LandingPage />;
}
