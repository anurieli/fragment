"use client";

import { useCallback, useEffect, useRef } from "react";

import { isTauri } from "@/lib/ai-client";
import { fuzzyTitleMatch, markdownToPlainText, parseSubstackFeed } from "@/lib/publish";
import { useContentStore } from "@/stores/content-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/hooks/use-toast";

const POLL_INTERVAL_MS = 3 * 60_000;

function extractHost(publicationUrl: string): string | null {
  const trimmed = publicationUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).hostname || null;
  } catch {
    return null;
  }
}

/**
 * Fetches `<pub>/feed`, routed through the local `rss-proxy` route (browser)
 * or Tauri's native HTTP plugin (desktop — the static-export build has no
 * Next.js server for `rss-proxy` to run on, same reasoning as
 * `src/lib/platform-fetch.ts`'s `codexFetch`). Returns `null` on any
 * failure — a missed poll tick, never an error the caller has to handle.
 */
async function fetchFeedXml(pub: string): Promise<string | null> {
  try {
    if (isTauri()) {
      const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
      const res = await tauriFetch(`https://${pub}/feed`);
      return res.ok ? await res.text() : null;
    }
    const res = await fetch(`/api/v1/rss-proxy?pub=${encodeURIComponent(pub)}`);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
}

/** Best-effort "what would this fragment be titled on Substack" guess. */
function titleOrFirstLine(title: string | undefined, body: string): string {
  if (title && title.trim()) return title.trim();
  return firstLine(markdownToPlainText(body));
}

/**
 * The Substack verified-publish loop's polling half. While any fragment is
 * awaiting confirmation, fetches the user's Substack RSS feed on mount and
 * every 3 minutes (visibility-gated, same pattern as `useAgentInbox`) and
 * fuzzy-matches titles against it. A match moves the fragment to "published"
 * with a verified publish record carrying the live URL off the feed.
 *
 * One field marks a fragment as awaiting confirmation, whichever surface fired
 * the publish: the persisted `ContentPiece.publishAttemptedAt`, stamped by both
 * the feed's Share menu and the editor's publish menu. It has to be persisted
 * because a fragment must still look pending tomorrow. (The editor used to
 * stamp an in-memory map whose match branch only fired a toast, so a draft
 * confirmed live on Substack never recorded the publish at all.)
 *
 * No-ops entirely (never even fetches) when the user hasn't set a Substack
 * publication URL in Settings, or nothing is pending.
 */
export function usePublishVerification(): void {
  const runningRef = useRef(false);

  const check = useCallback(async () => {
    if (runningRef.current) return;

    const profile = useSettingsStore.getState().settings.userProfile;
    const pub = extractHost(profile.substackPublicationUrl ?? "");
    if (!pub) return;

    const contentState = useContentStore.getState();
    const pendingPieces = Object.values(contentState.pieces).filter(
      (p) => p.publishAttemptedAt !== undefined && p.status !== "published" && p.deletedAt === undefined,
    );

    if (pendingPieces.length === 0) return;

    runningRef.current = true;
    try {
      const xml = await fetchFeedXml(pub);
      if (!xml) return;

      const items = parseSubstackFeed(xml);
      if (items.length === 0) return;
      const feedTitles = items.map((item) => item.title);
      const showToast = useToastStore.getState().showToast;

      for (const piece of pendingPieces) {
        const guess = titleOrFirstLine(piece.title, piece.body);
        if (!guess || !fuzzyTitleMatch(guess, feedTitles)) continue;
        const matched = items.find((item) => fuzzyTitleMatch(guess, [item.title]));
        contentState.setPieceStatus(piece.id, "published", {
          platform: "substack",
          method: "copy",
          url: matched?.link,
          publishedAt: Date.now(),
          verified: true,
        });
        showToast(`"${piece.title || guess}" is live on Substack.`);
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (timer) return;
      void check();
      timer = setInterval(() => void check(), POLL_INTERVAL_MS);
    }
    function stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }

    if (document.visibilityState === "visible") start();

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") start();
      else stop();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [check]);
}
