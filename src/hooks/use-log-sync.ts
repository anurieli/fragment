import { useEffect, useRef } from "react";
import { db } from "@/lib/db";
import { syncLogs } from "@/lib/convex-client";
import type { SyncableLog } from "@/lib/convex-client";
import { useDeviceId } from "./use-device-id";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 100;

export function useLogSync(): void {
  const deviceId = useDeviceId();
  const syncingRef = useRef(false);

  useEffect(() => {
    async function syncUnsyncedLogs() {
      if (syncingRef.current) return;
      if (!navigator.onLine) return;
      syncingRef.current = true;

      try {
        // Get unsynced logs: both explicitly false AND legacy logs without the field
        const unsyncedLogs = await db.apiLogs
          .filter((log) => !log.synced)
          .limit(BATCH_SIZE)
          .toArray();

        if (unsyncedLogs.length === 0) {
          syncingRef.current = false;
          return;
        }

        const logsToSync: SyncableLog[] = unsyncedLogs.map((log) => ({
          route: log.route,
          caller: log.caller,
          provider: log.provider,
          model: log.model,
          status: log.status,
          statusCode: log.statusCode,
          error: log.error,
          durationMs: log.durationMs,
          promptTokens: log.promptTokens,
          completionTokens: log.completionTokens,
          totalTokens: log.totalTokens,
          cost: log.cost,
          promptLength: log.promptLength,
          responseLength: log.responseLength,
          clientTimestamp: log.timestamp,
        }));

        await syncLogs(deviceId, logsToSync);

        // Mark as synced
        const ids = unsyncedLogs.map((l) => l.id);
        await db.apiLogs
          .where("id")
          .anyOf(ids)
          .modify({ synced: true });
      } catch {
        // Non-critical — will retry on next interval
      } finally {
        syncingRef.current = false;
      }
    }

    // Sync on mount
    void syncUnsyncedLogs();

    // Sync on interval
    const timer = setInterval(() => void syncUnsyncedLogs(), SYNC_INTERVAL_MS);

    // Sync on window focus
    const handleFocus = () => void syncUnsyncedLogs();
    window.addEventListener("focus", handleFocus);

    // Sync when coming back online
    const handleOnline = () => void syncUnsyncedLogs();
    window.addEventListener("online", handleOnline);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [deviceId]);
}
