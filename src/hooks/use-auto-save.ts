"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";

/** Recovery buffers are keyed by fragment id. Exported so the tab-close flush
 * in use-persistence.ts clears the same key this writes. */
export const RECOVERY_PREFIX = "fragment:recovery:";
const MICRO_SAVE_INTERVAL_MS = 3_000;
interface RecoveryEntry {
  pieceId: string;
  content: string;
  title: string;
  updatedAt: number;
}

/**
 * Writes the open fragment's live editor content to localStorage every 3
 * seconds as a crash-recovery buffer, and flushes the same text to IndexedDB
 * on the same tick. On startup, recoverFromCrash reconciles what it finds.
 */
export function useAutoSave() {
  const lastSavedContentRef = useRef<string | null>(null);

  // ─── Micro-save to localStorage every 3s ──────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const { liveEditorPieceId, liveEditorContent } = useAppStore.getState();
      const { pieces } = useContentStore.getState();

      if (!liveEditorPieceId || typeof liveEditorContent !== "string") return;

      const piece = pieces[liveEditorPieceId];
      if (!piece) return;

      // Only write if content has changed since last micro-save
      if (liveEditorContent === lastSavedContentRef.current) return;

      // Never overwrite a fragment that has text with an empty body: that
      // combination is a stale liveEditorContent, not something the writer did.
      if (!liveEditorContent.trim() && piece.body.trim()) return;

      lastSavedContentRef.current = liveEditorContent;

      const entry: RecoveryEntry = {
        pieceId: liveEditorPieceId,
        content: liveEditorContent,
        title: piece.title ?? "",
        updatedAt: Date.now(),
      };

      try {
        localStorage.setItem(
          `${RECOVERY_PREFIX}${liveEditorPieceId}`,
          JSON.stringify(entry),
        );
      } catch {
        // localStorage full or unavailable, silent fail
      }

      // Also flush to IndexedDB on the same interval for belt-and-suspenders
      useContentStore.getState().updatePiece(liveEditorPieceId, { body: liveEditorContent });
    }, MICRO_SAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // ─── Clear recovery entry when the fragment is saved cleanly ──────────
  const clearRecovery = useCallback((pieceId: string) => {
    try {
      localStorage.removeItem(`${RECOVERY_PREFIX}${pieceId}`);
    } catch {
      // silent
    }
  }, []);

  return { clearRecovery };
}

/**
 * Reconciles the crash-recovery buffers in localStorage against the fragments
 * already in memory. Called once during hydration, after the library has
 * loaded: a buffer is only worth applying if there is a fragment to compare it
 * against, and one whose fragment is gone is stale by definition.
 *
 * Returns the number of fragments recovered.
 */
export async function recoverFromCrash(): Promise<number> {
  let recovered = 0;

  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(RECOVERY_PREFIX)) {
        keys.push(key);
      }
    }

    const { pieces } = useContentStore.getState();

    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const entry: RecoveryEntry = JSON.parse(raw);
        const piece = pieces[entry.pieceId];

        if (!piece) {
          // The fragment was deleted, or the buffer predates the one-entity
          // switchover and is still keyed by a note id. Either way there is
          // nothing left for it to be reconciled against.
          localStorage.removeItem(key);
          continue;
        }

        // Recovery data is newer than what's in IndexedDB, so apply it
        if (entry.updatedAt > piece.updatedAt && entry.content !== piece.body) {
          useContentStore.getState().updatePiece(entry.pieceId, { body: entry.content });
          recovered++;
        }

        // Clean up recovery entry after successful reconciliation
        localStorage.removeItem(key);
      } catch {
        // Corrupt entry, remove it
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage unavailable
  }

  return recovered;
}
