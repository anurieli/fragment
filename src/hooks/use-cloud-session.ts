"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchCurrentUser, signOutOfCloud, type CloudUser } from "@/lib/sync/api";
import { resetSyncLink, syncNow } from "@/lib/sync/engine";

export type CloudSessionStatus = "loading" | "signed-in" | "signed-out" | "unavailable";

function apiBase(): string {
  return (process.env.NEXT_PUBLIC_FRAGMENT_API_BASE ?? "").replace(/\/$/, "");
}

export function useCloudSession() {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [status, setStatus] = useState<CloudSessionStatus>("loading");

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const next = await fetchCurrentUser();
      setUser(next);
      setStatus(next ? "signed-in" : "signed-out");
    } catch {
      setUser(null);
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const signIn = useCallback(() => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`${apiBase()}/api/v1/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
  }, []);

  const signOut = useCallback(async () => {
    await signOutOfCloud();
    await resetSyncLink();
    setUser(null);
    setStatus("signed-out");
  }, []);

  const sync = useCallback(async () => {
    await syncNow();
    await refresh();
  }, [refresh]);

  return { user, status, refresh, signIn, signOut, sync };
}
