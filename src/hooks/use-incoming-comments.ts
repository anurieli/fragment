"use client";

import { useCallback, useEffect, useState } from "react";
import { listShares } from "@/lib/sharing/client";

const SEEN_KEY_PREFIX = "fragment:comments-seen:";
const POLL_INTERVAL_MS = 60_000;

function seenKey(noteId: string): string {
  return `${SEEN_KEY_PREFIX}${noteId}`;
}

function readSeenCount(noteId: string): number {
  try {
    const raw = localStorage.getItem(seenKey(noteId));
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function writeSeenCount(noteId: string, count: number): void {
  try {
    localStorage.setItem(seenKey(noteId), String(count));
  } catch {
    // best effort — worst case the badge over-counts next load
  }
}

export interface IncomingComments {
  /** Total comments across every hosted share of this note, right now. */
  totalCount: number;
  /** totalCount minus what this browser has already been shown. */
  unreadCount: number;
  /** Mark everything currently known as seen — call when the panel opens. */
  markSeen: () => void;
}

/**
 * Tracks whether reviewers have left new comments on a note's hosted share
 * links, so the toolbar can read "3 new" instead of the writer having to open
 * a menu and click "Check for comments" on faith (ARI-245).
 *
 * Read state is local to this browser and nowhere else: there is no server
 * concept of "seen", and none is needed — it is a display nicety, not
 * something another device or the owner's other sessions need to agree on.
 */
export function useIncomingComments(noteId: string | null): IncomingComments {
  const [totalCount, setTotalCount] = useState(0);
  const [seenCount, setSeenCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!noteId) return;
    try {
      const shares = await listShares(noteId);
      setTotalCount(shares.reduce((sum, s) => sum + (s.commentCount ?? 0), 0));
    } catch {
      // Not signed in, offline, or self-hosted with no cloud — badge stays quiet.
    }
  }, [noteId]);

  useEffect(() => {
    if (!noteId) {
      setTotalCount(0);
      setSeenCount(0);
      return;
    }
    setSeenCount(readSeenCount(noteId));
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
  }, [noteId, refresh]);

  const markSeen = useCallback(() => {
    if (!noteId) return;
    setSeenCount(totalCount);
    writeSeenCount(noteId, totalCount);
  }, [noteId, totalCount]);

  return { totalCount, unreadCount: Math.max(0, totalCount - seenCount), markSeen };
}
