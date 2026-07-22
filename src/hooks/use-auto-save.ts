"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { saveNote } from "@/lib/persistence";

const RECOVERY_PREFIX = "fragment:recovery:";
const MICRO_SAVE_INTERVAL_MS = 3_000;
interface RecoveryEntry {
  noteId: string;
  content: string;
  title: string;
  updatedAt: number;
}

/**
 * Write the active note's live editor content to localStorage every 3 seconds
 * as a crash-recovery buffer. On startup, check for recovery data and reconcile.
 */
export function useAutoSave() {
  const lastSavedContentRef = useRef<string | null>(null);

  // ─── Micro-save to localStorage every 3s ──────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const { liveEditorNoteId, liveEditorContent } = useAppStore.getState();
      const { notes } = useDataStore.getState();

      if (!liveEditorNoteId || typeof liveEditorContent !== "string") return;

      const note = notes[liveEditorNoteId];
      if (!note) return;

      // Only write if content has changed since last micro-save
      if (liveEditorContent === lastSavedContentRef.current) return;

      // Never overwrite a note that has content with empty content —
      // this guards against stale liveEditorContent causing data loss
      if (!liveEditorContent.trim() && note.content.trim()) return;

      lastSavedContentRef.current = liveEditorContent;

      const entry: RecoveryEntry = {
        noteId: liveEditorNoteId,
        content: liveEditorContent,
        title: note.title,
        updatedAt: Date.now(),
      };

      try {
        localStorage.setItem(
          `${RECOVERY_PREFIX}${liveEditorNoteId}`,
          JSON.stringify(entry),
        );
      } catch {
        // localStorage full or unavailable — silent fail
      }

      // Also flush to IndexedDB on the same interval for belt-and-suspenders
      saveNote({ ...note, content: liveEditorContent, updatedAt: Date.now() });
    }, MICRO_SAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // ─── Clear recovery entry when note is saved cleanly ──────────────────
  const clearRecovery = useCallback((noteId: string) => {
    try {
      localStorage.removeItem(`${RECOVERY_PREFIX}${noteId}`);
    } catch {
      // silent
    }
  }, []);

  return { clearRecovery };
}

/**
 * Check for crash-recovery data in localStorage and reconcile with IndexedDB.
 * Called once during hydration. Returns the number of notes recovered.
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

    const { notes } = useDataStore.getState();

    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      try {
        const entry: RecoveryEntry = JSON.parse(raw);
        const note = notes[entry.noteId];

        if (!note) {
          // Note was deleted — clean up stale recovery data
          localStorage.removeItem(key);
          continue;
        }

        // Recovery data is newer than what's in IndexedDB — apply it
        if (entry.updatedAt > note.updatedAt && entry.content !== note.content) {
          useDataStore.getState().updateNoteContent(entry.noteId, entry.content);
          recovered++;
        }

        // Clean up recovery entry after successful reconciliation
        localStorage.removeItem(key);
      } catch {
        // Corrupt entry — remove it
        localStorage.removeItem(key);
      }
    }
  } catch {
    // localStorage unavailable
  }

  return recovered;
}
