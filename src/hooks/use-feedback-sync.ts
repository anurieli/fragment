import { useEffect, useRef } from "react";
import { db } from "@/lib/db";
import { submitFeedback } from "@/lib/cloud-client";
import { useDeviceId } from "./use-device-id";

export function useFeedbackSync(): void {
  const deviceId = useDeviceId();
  const syncingRef = useRef(false);

  useEffect(() => {
    async function syncPendingFeedback() {
      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        // Get all pending or failed items
        const items = await db.feedbackQueue
          .where("status")
          .anyOf(["pending", "failed"])
          .toArray();

        for (const item of items) {
          try {
            await submitFeedback(
              deviceId,
              {
                type: item.type,
                message: item.message,
                platform: item.metadata.platform,
                appVersion: item.metadata.appVersion,
                screenResolution: item.metadata.screenResolution,
                userAgent: item.metadata.userAgent,
                activePieceId: item.metadata.activePieceId,
              },
              {
                screenshot: item.screenshot,
                screenRecording: item.screenRecording,
                voiceNote: item.voiceNote,
              }
            );
            await db.feedbackQueue.update(item.id, {
              status: "submitted",
              submittedAt: Date.now(),
            });
          } catch {
            // Individual item failed — continue with next, will retry later
          }
        }
      } catch {
        // Non-critical — will retry on next trigger
      } finally {
        syncingRef.current = false;
      }
    }

    // Sync on mount (app launch)
    void syncPendingFeedback();

    // Sync when coming back online
    const handleOnline = () => void syncPendingFeedback();
    window.addEventListener("online", handleOnline);

    // Sync on window focus (user returns to app)
    const handleFocus = () => void syncPendingFeedback();
    window.addEventListener("focus", handleFocus);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("focus", handleFocus);
    };
  }, [deviceId]);
}
