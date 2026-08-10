"use client";

import { useCallback, useEffect, useState } from "react";
import { listShares } from "@/lib/sharing/client";

const SEEN_KEY_PREFIX = "fragment:comments-seen:";
const POLL_INTERVAL_MS = 60_000;

function seenKey(shareKey: string): string {
  return `${SEEN_KEY_PREFIX}${shareKey}`;
}

function readSeenCount(shareKey: string): number {
  try {
    const raw = localStorage.getItem(seenKey(shareKey));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeSeenCount(shareKey: string, count: number): void {
  try {
    localStorage.setItem(seenKey(shareKey), String(count));
  } catch {
    // best effort — worst case the badge over-counts next load
  }
}

export interface IncomingComments {
  /** Total comments across every hosted share of this fragment, right now. */
  totalCount: number;
  /** totalCount minus what this browser has already been shown. */
  unreadCount: number;
  /** Mark everything currently known as seen — call when the panel opens. */
  markSeen: () => void;
}

/**
 * Tracks whether reviewers have left new comments on a fragment's hosted share
 * links, so the toolbar can read "3 new" instead of the writer having to open
 * a menu and click "Check for comments" on faith (ARI-245).
 *
 * Takes a share key, not a fragment id: a migrated fragment's links were
 * minted against the note id it came from and still resolve under it, so
 * callers pass shareKeyFor(piece) (see src/lib/sharing/share-key.ts).
 *
 * Read state is local to this browser and nowhere else: there is no server
 * concept of "seen", and none is needed — it is a display nicety, not
 * something another device or the owner's other sessions need to agree on.
 */
export function useIncomingComments(shareKey: string | null): IncomingComments {
  const [totalCount, setTotalCount] = useState(0);
  const [seenCount, setSeenCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!shareKey) return;
    try {
      const shares = await listShares(shareKey);
      setTotalCount(shares.reduce((sum, s) => sum + (s.commentCount ?? 0), 0));
    } catch {
      // Not signed in, offline, or self-hosted with no cloud — badge stays quiet.
    }
  }, [shareKey]);

  useEffect(() => {
    if (!shareKey) {
      setTotalCount(0);
      setSeenCount(0);
      return;
    }
    setSeenCount(readSeenCount(shareKey));
    void refresh();

    function onFocus() {
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [shareKey, refresh]);

  const markSeen = useCallback(() => {
    if (!shareKey) return;
    setSeenCount(totalCount);
    writeSeenCount(shareKey, totalCount);
  }, [shareKey, totalCount]);

  return { totalCount, unreadCount: Math.max(0, totalCount - seenCount), markSeen };
}
