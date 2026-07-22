"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore, waitForSettingsHydration } from "@/stores/settings-store";
import { useVoiceStore, computeWritingStyleSeed } from "@/stores/voice-store";
import { loadAllNotes, loadSnippetsForNote, loadVersionsForNote, saveNote, loadAllVoices, saveVoice } from "@/lib/persistence";
import { recoverFromCrash } from "@/hooks/use-auto-save";
import { logPersistence } from "@/lib/persistence-logger";

export function usePersistence() {
  const activeNoteId = useAppStore((s) => s.activeNoteId);
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const { setNotes, setSnippets, setVersions, setHydrated } = useDataStore();
  const prevNoteId = useRef<string | null>(null);

  // Initial hydration + crash recovery
  useEffect(() => {
    async function hydrate() {
      try {
        const allNotes = await loadAllNotes();
        setNotes(allNotes);
        if (allNotes.length > 0) {
          setActiveNote(allNotes[0].id);
        }
      } catch {
        // loadAllNotes already falls back to localStorage internally,
        // so this catch is for truly catastrophic failures.
        logPersistence("hydrate_fail", { error: "loadAllNotes threw" });
        setNotes([]);
      }
      setHydrated(true);

      // Request persistent storage so the OS won't evict IndexedDB/localStorage.
      // Critical for Tauri (WKWebView) where storage is ephemeral by default.
      try {
        const persisted = await navigator.storage?.persist?.();
        logPersistence("storage_persist_result", { granted: persisted ?? "unsupported" });
      } catch {
        logPersistence("storage_persist_result", { granted: "error" });
      }

      // After hydration, check for crash-recovery data in localStorage
      try {
        const recovered = await recoverFromCrash();
        if (recovered > 0) {
          logPersistence("note_recovery", { recoveredCount: recovered });
          // Re-load notes to pick up recovered content
          try {
            const refreshed = await loadAllNotes();
            setNotes(refreshed);
          } catch {
            // keep the notes we already loaded
          }
        }
      } catch {
        // crash recovery failed — not critical
      }

      // Hydrate Brand Voices from IndexedDB, running the one-shot
      // writingStyle → Brand Voice migration. Waits for settings first so the
      // migration reads real persisted values, not DEFAULT_SETTINGS.
      try {
        await waitForSettingsHydration();
        const settingsStore = useSettingsStore.getState();
        const bv = settingsStore.settings.brandVoice;
        const voices = await loadAllVoices();
        const seed = computeWritingStyleSeed({
          migrated: bv.migratedFromWritingStyle,
          voiceDescription: settingsStore.settings.writingStyle.voiceDescription,
          existingCount: voices.length,
          now: Date.now(),
        });
        if (seed) {
          await saveVoice(seed);
          voices.push(seed);
          settingsStore.updateBrandVoiceSettings({
            defaultVoiceId: bv.defaultVoiceId ?? seed.id,
            migratedFromWritingStyle: true,
          });
        } else if (!bv.migratedFromWritingStyle) {
          settingsStore.updateBrandVoiceSettings({ migratedFromWritingStyle: true });
        }
        useVoiceStore.getState().setVoices(voices);
      } catch {
        logPersistence("voice_hydrate_fail", { error: "loadAllVoices threw" });
      } finally {
        useVoiceStore.getState().setHydrated(true);
      }
    }
    hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load snippets when note changes
  useEffect(() => {
    if (!activeNoteId || activeNoteId === prevNoteId.current) return;
    prevNoteId.current = activeNoteId;

    async function load() {
      const snippets = await loadSnippetsForNote(activeNoteId!);
      setSnippets(snippets);
      const versions = await loadVersionsForNote(activeNoteId!);
      setVersions(versions);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  // Save on tab close / visibility change
  useEffect(() => {
    function flushAll() {
      const dataState = useDataStore.getState();
      const appState = useAppStore.getState();
      const id = appState.activeNoteId;
      const liveId = appState.liveEditorNoteId;

      // Save the note the editor is tracking (may differ from activeNoteId
      // during a note switch, before the editor effect runs).
      if (liveId && liveId !== id && dataState.notes[liveId] && typeof appState.liveEditorContent === "string") {
        const liveNote = dataState.notes[liveId];
        // Don't overwrite real content with empty — guard against stale liveEditorContent
        const liveContent = appState.liveEditorContent.trim() || liveNote.content.trim()
          ? appState.liveEditorContent || liveNote.content
          : "";
        saveNote({ ...liveNote, content: liveContent, updatedAt: Date.now() });
        try { localStorage.removeItem(`fragment:recovery:${liveId}`); } catch { /* silent */ }
      }

      if (id && dataState.notes[id]) {
        const note = dataState.notes[id];
        // The editor debounces saves by 500ms, so the store may be stale.
        // Use liveEditorContent (updated on every keystroke) to ensure
        // the latest content is persisted on tab close / visibility change.
        if (liveId === id && typeof appState.liveEditorContent === "string") {
          // Don't overwrite real content with empty — guard against stale liveEditorContent
          const contentToSave = !appState.liveEditorContent.trim() && note.content.trim()
            ? note.content
            : appState.liveEditorContent;
          saveNote({ ...note, content: contentToSave, updatedAt: Date.now() });
        } else {
          saveNote(note);
        }

        // Clean up recovery entry — the note was saved cleanly
        try {
          localStorage.removeItem(`fragment:recovery:${id}`);
        } catch {
          // silent
        }
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushAll();
      }
    }

    window.addEventListener("beforeunload", flushAll);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("beforeunload", flushAll);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // flushAll reads state via getState() — no render-time dependencies needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
