"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore, waitForSettingsHydration } from "@/stores/settings-store";
import { useVoiceStore, computeWritingStyleSeed } from "@/stores/voice-store";
import { useContentStore } from "@/stores/content-store";
import { isLongformFormat } from "@/lib/content-engine";
import {
  loadSnippetsForPiece,
  loadSnippetsForIdea,
  loadVersionsForPiece,
  loadAllPieceVersions,
  loadAllVoices,
  saveVoice,
  loadAllIdeas,
  loadAllContentPieces,
  loadAllResources,
  loadCommentsForPiece,
  loadCommentsForIdea,
} from "@/lib/persistence";
import { commentHome } from "@/lib/comment-scope";
import { recoverFromCrash, RECOVERY_PREFIX } from "@/hooks/use-auto-save";
import { logPersistence } from "@/lib/persistence-logger";
import { useToastStore } from "@/hooks/use-toast";
import { installMigrationConsole } from "@/lib/migration/console";
import { readMigrationRecord, runOneEntityMigration } from "@/lib/migration/run";
import type { MigrationRecord } from "@/lib/types";

export interface PersistenceState {
  /** True when the one-entity migration refused to finish. Nothing was
   * hydrated, so the shell must render the blocking screen rather than a
   * library that would look emptied. */
  migrationFailed: boolean;
  /** What the migration recorded about the refusal, for the details panel. */
  migrationRecord: MigrationRecord | undefined;
  /** Run the migration again and, if it finishes this time, hydrate. */
  retryMigration: () => void;
}

/**
 * Brings the library into memory, once, in the only order that is safe.
 *
 * The one-entity migration runs before anything is read. It is the step that
 * moves each note's text into the fragment that now owns it, so hydrating
 * ahead of it would put a library on screen missing everything not yet carried
 * across, and a writer editing that library writes the gap in. When the
 * migration refuses to finish, nothing is loaded at all: `migrationFailed`
 * goes up and the shell shows the blocking screen instead of the app.
 */
export function usePersistence(): PersistenceState {
  const activePieceId = useAppStore((s) => s.activePieceId);
  const activeIdeaId = useAppStore((s) => s.activeIdeaId);
  const activeIdeaSpace = useAppStore((s) => (s.activeIdeaId ? s.ideaSpaces[s.activeIdeaId] : undefined));
  const setSnippets = useDataStore((s) => s.setSnippets);
  const setVersions = useDataStore((s) => s.setVersions);
  const prevPieceId = useRef<string | null>(null);
  const prevSnipScope = useRef<{ pieceId: string | null; ideaId: string | null }>({ pieceId: null, ideaId: null });
  const prevCommentHomeKey = useRef<string>("");

  const [migrationFailed, setMigrationFailed] = useState(false);
  const [migrationRecord, setMigrationRecord] = useState<MigrationRecord | undefined>(undefined);
  const startupRunning = useRef(false);

  const hydrate = useCallback(async () => {
    // The Content Engine is the library: ideas, the fragments inside them, and
    // the resources hanging off both. Version rows load with them so the
    // timeline has something to show for whichever fragment opens first,
    // before the per-fragment read further down narrows it.
    try {
      const [ideas, pieces, resources, versions] = await Promise.all([
        loadAllIdeas(),
        loadAllContentPieces(),
        loadAllResources(),
        loadAllPieceVersions(),
      ]);
      const content = useContentStore.getState();
      content.setIdeas(ideas);
      content.setPieces(pieces);
      content.setResources(resources);
      useDataStore.getState().setVersions(versions);

      // Open on the draft last worked on, and on the idea around it. Opening
      // the fragment alone would start the session with no idea context and no
      // Write | Pieces toggle, even though the sidebar lists it under that idea.
      const lastDraft = pieces
        .filter((piece) => piece.deletedAt === undefined && isLongformFormat(piece.format))
        .sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (lastDraft) {
        useAppStore.getState().setActivePiece(lastDraft.id);
        useAppStore.getState().setActiveIdea(lastDraft.ideaId);
      }
      content.setLoadFailed(false);
    } catch {
      // The library could not be read. Do NOT leave the empty maps looking
      // like an empty library: the agent-inbox importer reads them as "none
      // of this exists yet", re-imports every pending handoff at its file
      // status, and acks the source markdown out of the inbox, turning a
      // failed read into permanent loss. loadFailed makes the importer stand
      // down until a reload succeeds.
      logPersistence("hydrate_fail", { error: "content-engine load threw" });
      useContentStore.getState().setLoadFailed(true);
      useToastStore
        .getState()
        .showToast("Couldn't open your library, reload before editing");
    } finally {
      useContentStore.getState().setHydrated(true);
      useDataStore.getState().setHydrated(true);
    }

    // Request persistent storage so the OS won't evict IndexedDB/localStorage.
    // Critical for Tauri (WKWebView) where storage is ephemeral by default.
    try {
      const persisted = await navigator.storage?.persist?.();
      logPersistence("storage_persist_result", { granted: persisted ?? "unsupported" });
    } catch {
      logPersistence("storage_persist_result", { granted: "error" });
    }

    // Drain the crash-recovery buffer. It writes straight through updatePiece,
    // which puts the recovered text in the store and on disk in one move, so
    // there is nothing to re-read afterwards.
    try {
      const recovered = await recoverFromCrash();
      if (recovered > 0) {
        // The event name is fixed by the shared log union in
        // persistence-logger.ts; what it counts is fragments.
        logPersistence("note_recovery", { recoveredCount: recovered });
      }
    } catch {
      // crash recovery failed, not critical
    }

    // Hydrate Brand Voices from IndexedDB, running the one-shot
    // writingStyle -> Brand Voice migration. Waits for settings first so the
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
  }, []);

  const runStartup = useCallback(async () => {
    if (startupRunning.current) return;
    startupRunning.current = true;
    try {
      let failed = false;
      try {
        const outcome = await runOneEntityMigration();
        failed = outcome.status === "failed";
      } catch {
        // The migration records its own failure before rethrowing, so the row
        // on disk is the honest account of what went wrong.
        failed = true;
      }

      if (failed) {
        const record = await readMigrationRecord().catch(() => undefined);
        setMigrationRecord(record);
        setMigrationFailed(true);
        return;
      }

      setMigrationFailed(false);
      await hydrate();
    } finally {
      startupRunning.current = false;
    }
  }, [hydrate]);

  const retryMigration = useCallback(() => {
    // Down goes the blocking screen while the retry runs: the shell falls back
    // to its loading state, which is the only feedback this button can give.
    setMigrationFailed(false);
    void runStartup();
  }, [runStartup]);

  useEffect(() => {
    // Read-only migration tools, reachable as window.fragmentMigration. The
    // dry run has to run where the library lives, which is this browser.
    installMigrationConsole();
    void runStartup();
    // Startup runs once per mount; runStartup guards itself against overlap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load versions when the fragment changes.
  useEffect(() => {
    if (!activePieceId || activePieceId === prevPieceId.current) return;
    prevPieceId.current = activePieceId;

    async function load() {
      const versions = await loadVersionsForPiece(activePieceId!);
      setVersions(versions);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePieceId]);

  // Load the snippets in scope: the active fragment's, plus the open idea's
  // (snips taken where no single fragment owns them, see snip-scope.ts). Both,
  // not either: inside an idea with a draft open, the bar shows one pile of
  // parts whichever space you're in, and crossing Write <-> Pieces never
  // empties it.
  useEffect(() => {
    if (activePieceId === prevSnipScope.current.pieceId && activeIdeaId === prevSnipScope.current.ideaId) return;
    prevSnipScope.current = { pieceId: activePieceId, ideaId: activeIdeaId };

    let cancelled = false;
    async function load() {
      const [pieceSnippets, ideaSnippets] = await Promise.all([
        activePieceId ? loadSnippetsForPiece(activePieceId) : Promise.resolve([]),
        activeIdeaId ? loadSnippetsForIdea(activeIdeaId) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      // A snippet cut off a draft inside an idea is in both results.
      const byId = new Map(pieceSnippets.map((s) => [s.id, s]));
      for (const s of ideaSnippets) byId.set(s.id, s);
      setSnippets([...byId.values()]);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePieceId, activeIdeaId]);

  // Load the comments for whichever single home is on screen (see
  // commentHome in comment-scope.ts) — a comment has one home for its whole
  // life, unlike a snippet's dual-carry, so this is a single scoped read
  // rather than the merge above.
  useEffect(() => {
    const home = commentHome(activePieceId, activeIdeaId, activeIdeaSpace);
    const key = home ? `${home.pieceId ?? ""}:${home.ideaId ?? ""}` : "";
    if (key === prevCommentHomeKey.current) return;
    prevCommentHomeKey.current = key;

    let cancelled = false;
    async function load() {
      if (!home) {
        useDataStore.getState().setComments([]);
        return;
      }
      const comments = home.pieceId
        ? await loadCommentsForPiece(home.pieceId)
        : await loadCommentsForIdea(home.ideaId!);
      if (cancelled) return;
      useDataStore.getState().setComments(comments);
    }
    load();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePieceId, activeIdeaId, activeIdeaSpace]);

  // Save on tab close / visibility change
  useEffect(() => {
    function flushAll() {
      const app = useAppStore.getState();
      const content = useContentStore.getState();

      function flush(pieceId: string) {
        const piece = content.pieces[pieceId];
        if (!piece) return;
        // The editor debounces saves by 500ms, so the store can be a keystroke
        // or two behind. liveEditorContent moves on every keystroke, so it is
        // what reaches disk here, except when it is empty against a fragment
        // that has text: that combination is a stale buffer, never a deletion.
        const live =
          app.liveEditorPieceId === pieceId && typeof app.liveEditorContent === "string"
            ? app.liveEditorContent
            : null;
        const body = live !== null && (live.trim() || !piece.body.trim()) ? live : piece.body;
        content.updatePiece(pieceId, { body });

        // The fragment was saved cleanly, so its recovery buffer has nothing
        // left to say.
        try {
          localStorage.removeItem(`${RECOVERY_PREFIX}${pieceId}`);
        } catch {
          // silent
        }
      }

      // The editor may still be tracking the fragment you just navigated away
      // from, so both get flushed.
      const liveId = app.liveEditorPieceId;
      if (liveId && liveId !== app.activePieceId) flush(liveId);
      if (app.activePieceId) flush(app.activePieceId);
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
    // flushAll reads state via getState(), no render-time dependencies needed.
  }, []);

  return { migrationFailed, migrationRecord, retryMigration };
}
