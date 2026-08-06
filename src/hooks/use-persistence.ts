"use client";

import { useEffect, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore, waitForSettingsHydration } from "@/stores/settings-store";
import { useVoiceStore, computeWritingStyleSeed } from "@/stores/voice-store";
import { useContentStore } from "@/stores/content-store";
import { loadAllNotes, loadSnippetsForNote, loadSnippetsForIdea, loadVersionsForNote, saveNote, loadAllVoices, saveVoice, loadAllIdeas, loadAllContentPieces, loadAllResources, loadCommentsForNote, loadCommentsForIdea } from "@/lib/persistence";
import { commentHome } from "@/lib/comment-scope";
import { recoverFromCrash } from "@/hooks/use-auto-save";
import { logPersistence } from "@/lib/persistence-logger";
import { useToastStore } from "@/hooks/use-toast";

export function usePersistence() {
  const activeNoteId = useAppStore((s) => s.activeNoteId);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const activeIdeaSpace = useAppStore((s) => (s.activeIdeaId ? s.ideaSpaces[s.activeIdeaId] : undefined));
  const setActiveNote = useAppStore((s) => s.setActiveNote);
  const { setNotes, setSnippets, setVersions, setComments, setHydrated } = useDataStore();
  const {
    setIdeas,
    setPieces,
    setResources,
    setHydrated: setContentHydrated,
    setLoadFailed: setContentLoadFailed,
  } = useContentStore();
  const prevNoteId = useRef<string | null>(null);
  const prevSnipScope = useRef<{ noteId: string | null; ideaId: string | null }>({ noteId: null, ideaId: null });
  const prevCommentHomeKey = useRef<string>("");

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

      // Hydrate the Content Engine (ideas + pieces) from IndexedDB. New
      // tables, so an empty result on first load is the expected steady state.
      try {
        const [ideas, pieces, resources] = await Promise.all([
          loadAllIdeas(),
          loadAllContentPieces(),
          loadAllResources(),
        ]);
        setIdeas(ideas);
        setPieces(pieces);
        setResources(resources);
        // The restored note may be a draft of an idea. Ideas load after
        // notes, so re-open the idea around it here — otherwise the session
        // starts inside a draft with no idea context and no Write | Pieces
        // toggle, even though the sidebar lists it under that idea.
        const restoredNoteId = useAppStore.getState().activeNoteId;
        if (restoredNoteId) {
          const owner = pieces.find(
            (piece) => piece.noteId === restoredNoteId && piece.deletedAt === undefined,
          );
          if (owner) useAppStore.getState().setActiveIdea(owner.ideaId);
        }
        setContentLoadFailed(false);
      } catch (error) {
        // The library could not be read. Do NOT leave the empty maps looking
        // like an empty library: the agent-inbox importer reads them as "none
        // of this exists yet", re-imports every pending handoff at its file
        // status, and acks the source markdown out of the inbox — turning a
        // failed read into permanent loss. loadFailed makes the importer stand
        // down until a reload succeeds.
        logPersistence("hydrate_fail", { error: "content-engine load threw" });
        setContentLoadFailed(true);
        useToastStore
          .getState()
          .showToast("Couldn't open your library — reload before editing");
      } finally {
        setContentHydrated(true);
      }

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

  // Load versions when the note changes.
  useEffect(() => {
    if (!activeNoteId || activeNoteId === prevNoteId.current) return;
    prevNoteId.current = activeNoteId;

    async function load() {
      const versions = await loadVersionsForNote(activeNoteId!);
      setVersions(versions);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  // Load the snippets in scope: the active note's, plus the open idea's (its
  // pieces' snips have no note to hang off — see snip-scope.ts). Both, not
  // either: inside an idea with a draft open, the bar shows one pile of parts
  // whichever space you're in, and crossing Write <-> Pieces never empties it.
  useEffect(() => {
    if (activeNoteId === prevSnipScope.current.noteId && activeIdeaId === prevSnipScope.current.ideaId) return;
    prevSnipScope.current = { noteId: activeNoteId, ideaId: activeIdeaId };

    let cancelled = false;
    async function load() {
      const [noteSnippets, ideaSnippets] = await Promise.all([
        activeNoteId ? loadSnippetsForNote(activeNoteId) : Promise.resolve([]),
        activeIdeaId ? loadSnippetsForIdea(activeIdeaId) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      // A snippet cut off a draft inside an idea is in both results.
      const byId = new Map(noteSnippets.map((s) => [s.id, s]));
      for (const s of ideaSnippets) byId.set(s.id, s);
      setSnippets([...byId.values()]);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, activeIdeaId]);

  // Load the comments for whichever single home is on screen (see
  // commentHome in comment-scope.ts) — a comment has one home for its whole
  // life, unlike a snippet's dual-carry, so this is a single scoped read
  // rather than the merge above.
  useEffect(() => {
    const home = commentHome(activeNoteId, activeIdeaId, activeIdeaSpace);
    const key = home ? `${home.noteId ?? ""}:${home.ideaId ?? ""}` : "";
    if (key === prevCommentHomeKey.current) return;
    prevCommentHomeKey.current = key;

    let cancelled = false;
    async function load() {
      if (!home) {
        setComments([]);
        return;
      }
      const comments = home.noteId
        ? await loadCommentsForNote(home.noteId)
        : await loadCommentsForIdea(home.ideaId!);
      if (cancelled) return;
      setComments(comments);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId, activeIdeaId, activeIdeaSpace]);

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
