import * as Sentry from "@sentry/browser";

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

let initialized = false;

export function initSentry(): void {
  if (!SENTRY_DSN || initialized) return;

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "production",
      release: process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0",
      // Keep sample rate conservative for a desktop app
      tracesSampleRate: 0.2,
      beforeSend(event) {
        // Strip local file paths to protect user privacy (macOS usernames in paths)
        if (event.exception?.values) {
          for (const exception of event.exception.values) {
            if (exception.stacktrace?.frames) {
              for (const frame of exception.stacktrace.frames) {
                if (frame.filename) {
                  frame.filename = frame.filename.replace(/^.*?\/fragment\//, "fragment/");
                }
                if (frame.abs_path) {
                  frame.abs_path = frame.abs_path.replace(/^.*?\/fragment\//, "fragment/");
                }
              }
            }
          }
        }
        return event;
      },
    });

    initialized = true;
  } catch {
    // Non-critical — Sentry failure must not crash the app
  }
}

export function setSentryUser(deviceId: string): void {
  if (!SENTRY_DSN) return;
  try {
    Sentry.setUser({ id: deviceId });
  } catch {
    // Non-critical
  }
}

export function captureException(error: unknown): void {
  if (!SENTRY_DSN) return;
  try {
    Sentry.captureException(error);
  } catch {
    // Non-critical
  }
}
