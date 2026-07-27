import { create } from "zustand";
import type { SyncSnapshot } from "@/lib/sync/engine";

/**
 * The sync engine's state, mirrored into Zustand so components can read it.
 *
 * The engine deliberately has no React dependency — it runs from module scope
 * and must work in tests and in a worker — so this store is the one place
 * that bridges its subscription into the component tree.
 */

interface SyncStoreState {
  snapshot: SyncSnapshot;
  setSnapshot: (snapshot: SyncSnapshot) => void;
}

const INITIAL: SyncSnapshot = {
  status: "signed-out",
  lastSyncedAt: null,
  pending: 0,
  error: null,
  dataRevision: 0,
};

export const useSyncStore = create<SyncStoreState>((set) => ({
  snapshot: INITIAL,
  setSnapshot: (snapshot) => set({ snapshot }),
}));
