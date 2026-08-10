"use client";

import { useEffect } from "react";
import { useDataStore } from "@/stores/data-store";
import { useContentStore } from "@/stores/content-store";
import { useAppStore } from "@/stores/app-store";
import { useVoiceStore } from "@/stores/voice-store";
import { refreshSettingsFromDatabase } from "@/stores/settings-store";
import { useSyncStore } from "@/stores/sync-store";
import {
  startSyncEngine,
  subscribeToSync,
  getSyncSnapshot,
} from "@/lib/sync/engine";
import {
  loadAllIdeas,
  loadAllContentPieces,
  loadAllResources,
  loadAllVoices,
  loadSnippetsForIdea,
  loadSnippetsForPiece,
  loadVersionsForPiece,
} from "@/lib/persistence";

/**
 * Runs cloud sync for the lifetime of the app shell.
 *
 * Two jobs. It starts the engine, and it puts pulled changes on screen: the
 * engine writes to IndexedDB, but the Zustand stores hold their own copy in
 * memory and would happily keep showing the pre-sync version until a reload.
 * `dataRevision` increments only when remote changes actually landed, so this
 * refetch does not run on ordinary local edits.
 */
export function useCloudSync(): void {
  const setSnapshot = useSyncStore((s) => s.setSnapshot);

  useEffect(() => {
    setSnapshot(getSyncSnapshot());
    const unsubscribe = subscribeToSync(setSnapshot);
    const stop = startSyncEngine();
    return () => {
      unsubscribe();
      stop();
    };
  }, [setSnapshot]);

  const dataRevision = useSyncStore((s) => s.snapshot.dataRevision);

  useEffect(() => {
    if (dataRevision === 0) return;

    let cancelled = false;

    async function refresh() {
      try {
        const activePieceId = useAppStore.getState().activePieceId;
        const activeIdeaId = useAppStore.getState().activeIdeaId;
        const [ideas, pieces, resources, voices, pieceSnippets, ideaSnippets, versions] = await Promise.all([
          loadAllIdeas(),
          loadAllContentPieces(),
          loadAllResources(),
          loadAllVoices(),
          activePieceId ? loadSnippetsForPiece(activePieceId) : Promise.resolve([]),
          activeIdeaId ? loadSnippetsForIdea(activeIdeaId) : Promise.resolve([]),
          activePieceId ? loadVersionsForPiece(activePieceId) : Promise.resolve([]),
        ]);
        await refreshSettingsFromDatabase();
        if (cancelled) return;

        useContentStore.getState().setIdeas(ideas);
        useContentStore.getState().setPieces(pieces);
        useContentStore.getState().setResources(resources);
        const snippets = [...pieceSnippets, ...ideaSnippets].filter(
          (snippet, index, all) => all.findIndex((candidate) => candidate.id === snippet.id) === index,
        );
        useDataStore.getState().setSnippets(snippets);
        useDataStore.getState().setVersions(versions);
        useVoiceStore.getState().replaceVoices(voices);
      } catch {
        // The next sync bumps the revision again; a missed refresh is a stale
        // screen for a few seconds, never lost data.
      }
    }

    void refresh();
    return () => {
      cancelled = true;
    };
  }, [dataRevision]);
}
