"use client";

import { useEffect } from "react";
import { useDataStore } from "@/stores/data-store";
import { useContentStore } from "@/stores/content-store";
import { useSyncStore } from "@/stores/sync-store";
import {
  startSyncEngine,
  subscribeToSync,
  getSyncSnapshot,
} from "@/lib/sync/engine";
import {
  loadAllNotes,
  loadAllIdeas,
  loadAllContentPieces,
  loadAllResources,
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
        const [notes, ideas, pieces, resources] = await Promise.all([
          loadAllNotes(),
          loadAllIdeas(),
          loadAllContentPieces(),
          loadAllResources(),
        ]);
        if (cancelled) return;

        useDataStore.getState().setNotes(notes);
        useContentStore.getState().setIdeas(ideas);
        useContentStore.getState().setPieces(pieces);
        useContentStore.getState().setResources(resources);
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
