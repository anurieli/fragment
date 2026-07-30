import type { SyncRequest, SyncResponse } from "./protocol";

/**
 * Talking to the cloud.
 *
 * The base URL is configurable because not every Fragment build is served by
 * the server it syncs with. The web app is same-origin and needs nothing; the
 * Tauri desktop build is a static export with no API routes of its own and
 * has to be pointed at a deployment.
 */

export interface CloudUser {
  id: string;
  email: string | null;
  name: string | null;
}

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_FRAGMENT_API_BASE ?? "").replace(/\/$/, "");
}

/** True when this build has somewhere to sync to. */
export function isCloudReachable(): boolean {
  // Same-origin (a served web app) always is; a static export needs a base.
  if (typeof window === "undefined") return false;
  if (apiBase()) return true;
  return window.location.protocol === "http:" || window.location.protocol === "https:";
}

export class CloudUnavailable extends Error {}
export class NotSignedIn extends Error {}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    // Sessions ride in an httpOnly cookie, which a cross-origin desktop build
    // only sends when credentials are explicitly included.
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (res.status === 401) throw new NotSignedIn("Not signed in");
  if (res.status === 503) throw new CloudUnavailable("No cloud configured");

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      // Keep the status line.
    }
    throw new Error(detail);
  }

  return (await res.json()) as T;
}

/** The signed-in user, or null. Never throws for the ordinary signed-out case. */
export async function fetchCurrentUser(): Promise<CloudUser | null> {
  try {
    const { user } = await request<{ user: CloudUser | null }>("/api/v1/auth/session", {
      method: "GET",
    });
    return user;
  } catch {
    return null;
  }
}

export async function signOutOfCloud(): Promise<void> {
  await request<{ ok: boolean }>("/api/v1/auth/session", { method: "DELETE" });
}

export async function postSync(body: SyncRequest): Promise<SyncResponse> {
  return request<SyncResponse>("/api/v1/sync", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
