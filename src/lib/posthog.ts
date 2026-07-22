import posthog from "posthog-js";

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

let initialized = false;

export function initPostHog(deviceId: string): void {
  if (!POSTHOG_KEY || initialized) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: false, // Desktop app, not a website
    capture_pageleave: false,
    persistence: "localStorage",
    autocapture: false, // We control what gets tracked
  });

  posthog.identify(deviceId);
  initialized = true;
}

export function captureEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!POSTHOG_KEY) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Non-critical — never crash for telemetry
  }
}

export function setUserProperties(
  properties: Record<string, unknown>,
): void {
  if (!POSTHOG_KEY) return;
  try {
    posthog.people.set(properties);
  } catch {
    // Non-critical
  }
}
