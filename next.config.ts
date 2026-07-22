import type { NextConfig } from "next";

// The Tauri desktop build is a static export; `headers()` is unsupported there
// and the app is served locally, so security headers only apply to the web build.
const isStaticExport = Boolean(process.env.TAURI_ENV_PLATFORM);

// Baseline hardening headers for the hosted web app. A strict Content-Security-
// Policy is deliberately deferred to a follow-up so it can be verified against
// the live editor (Tiptap), PostHog, and Sentry without shipping a broken policy.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Microphone is intentionally left at its default (self) — voice capture needs it.
  { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  ...(isStaticExport
    ? { output: "export" }
    : {
        async headers() {
          return [{ source: "/:path*", headers: securityHeaders }];
        },
      }),
};

export default nextConfig;
