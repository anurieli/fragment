"use client";

import { useCallback, useEffect, useRef } from "react";

import { isTauri } from "@/lib/ai-client";
import { fuzzyTitleMatch, markdownToPlainText, parseSubstackFeed } from "@/lib/publish";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";
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
 * fuzzy-matches titles against it.
 *
 * Two things mark a fragment as awaiting confirmation, and they are not the
 * same thing. A publish fired from the feed stamps
 * `ContentPiece.publishAttemptedAt`, which is persisted because a card has to
 * still look pending tomorrow; a match moves it to "published" with a verified
 * publish record. A publish fired from the editor lands in `data-store`'s
 * in-memory `pendingSubstackPublish` map instead, and a match there only
 * clears the flag: that path has never written a publish record, and giving it
 * one is a change of behaviour rather than a change of shape.
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

    const dataState = useDataStore.getState();
    const pendingEditorIds = Object.keys(dataState.pendingSubstackPublish);

    if (pendingPieces.length === 0 && pendingEditorIds.length === 0) return;

    runningRef.current = true;
    try {
      const xml = await fetchFeedXml(pub);
      if (!xml) return;

      const items = parseSubstackFeed(xml);
      if (items.length === 0) return;
      const feedTitles = items.map((item) => item.title);
      const showToast = useToastStore.getState().showToast;

      // Both routes can now be pending on the same fragment, so what the feed
      // route already confirmed is not announced a second time by the editor's.
      const confirmed = new Set<string>();

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
        confirmed.add(piece.id);
        dataState.clearPiecePublishPending(piece.id);
        showToast(`"${piece.title || guess}" is live on Substack.`);
      }

      for (const pieceId of pendingEditorIds) {
        if (confirmed.has(pieceId)) continue;
        const piece = contentState.pieces[pieceId];
        if (!piece) {
          dataState.clearPiecePublishPending(pieceId);
          continue;
        }
        const guess = titleOrFirstLine(piece.title, piece.body);
        if (!guess || !fuzzyTitleMatch(guess, feedTitles)) continue;
        dataState.clearPiecePublishPending(pieceId);
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
