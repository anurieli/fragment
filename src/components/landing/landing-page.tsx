"use client";

/**
 * Placeholder. The real marketing/landing page lives in the private
 * fragment-cloud repo (this file only needs to exist so `NEXT_PUBLIC_
 * FRAGMENT_HOSTED=true` self-host builds still compile - see src/app/page.tsx,
 * which renders this only when hosted). A self-hoster who flips that flag on
 * their own domain should see something generic, not Ariel's SaaS copy.
 */
export function LandingPage() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface text-text-secondary">
      <p className="text-sm">Fragment</p>
    </div>
  );
}
