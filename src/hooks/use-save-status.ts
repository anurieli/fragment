"use client";

import { useEffect, useState, useRef } from "react";
import { useAppStore } from "@/stores/app-store";

export type SaveStatus = "saved" | "saving";

/**
 * Tracks whether the active fragment's editor content matches what's persisted.
 * Returns "saving" while the debounce hasn't flushed yet, "saved" once it has.
 */
export function useSaveStatus(): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // The live editor buffer is the only thing that moves ahead of disk, so
    // watching it is enough to know a save is outstanding.
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
