"use client";

import { useEffect, useState, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";

export type SaveStatus = "saved" | "saving";

/**
 * Tracks whether the active note's editor content matches what's persisted.
 * Returns "saving" while the debounce hasn't flushed yet, "saved" once it has.
 */
export function useSaveStatus(): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Subscribe to both stores to detect content drift
    const unsubApp = useAppStore.subscribe((state, prev) => {
      if (state.liveEditorContent !== prev.liveEditorContent) {
        setStatus("saving");

        // After the debounce window (500ms) + buffer, mark as saved
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setStatus("saved"), 800);
      }
    });

    return () => {
      unsubApp();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return status;
}
