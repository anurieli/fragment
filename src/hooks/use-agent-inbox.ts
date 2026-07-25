"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isTauri } from "@/lib/ai-client";
import { importHandoffFiles, type AgentInboxFile } from "@/lib/agent-inbox/import";
import { ackTauriImportedFiles, readTauriInboxFiles } from "@/lib/agent-inbox/tauri-inbox";
import { generateId } from "@/lib/utils";
import { saveIdea, savePiece, saveResource } from "@/lib/persistence";
import { useContentStore } from "@/stores/content-store";

const POLL_INTERVAL_MS = 10_000;

async function fetchIngressFiles(sinceMs: number | undefined): Promise<{
  files: AgentInboxFile[];
  gateOpen: boolean;
}> {
  const params = new URLSearchParams();
  if (sinceMs !== undefined) params.set("since", String(sinceMs));
  const query = params.toString();

  const res = await fetch(`/api/v1/agent-inbox${query ? `?${query}` : ""}`);
  if (res.status === 404) {
    return { files: [], gateOpen: false };
  }
  if (!res.ok) {
    return { files: [], gateOpen: true };
  }
  const files = (await res.json()) as AgentInboxFile[];
  return { files, gateOpen: true };
}

async function ackIngress(relPaths: readonly string[]): Promise<void> {
  if (relPaths.length === 0) return;
  await fetch("/api/v1/agent-inbox/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imported: relPaths }),
  });
}

/**
 * Polls the agent inbox (HTTP ingress route in the browser, direct fs reads
 * in Tauri) and imports any pending handoff files into the content store.
 *
 * Runs once on mount and every 10s while the tab/window is visible; the
 * timer is cleared on `visibilitychange` -> hidden and restarted on
 * visible, so a backgrounded tab never polls.
 *
 * When local ingress is disabled server-side (the gate in
 * src/lib/agent-inbox/gate.ts is closed — self-host default), the GET route
 * 404s and this hook silently no-ops: no console noise, just
 * `ingressAvailable` staying false. Tauri mode reads the filesystem
 * directly and isn't subject to that gate.
 *
 * `refreshInbox` is exported for a manual "refresh inbox" affordance —
 * intentionally not wired to any UI here; a future toolbar button can call
 * it directly.
 */
export function useAgentInbox() {
  const [ingressAvailable, setIngressAvailable] = useState(false);
  const cursorRef = useRef<number | undefined>(undefined);
  const runningRef = useRef(false);

  const refreshInbox = useCallback(async () => {
    if (runningRef.current) return;
    if (!useContentStore.getState().hydrated) return;
    runningRef.current = true;

    try {
      let files: AgentInboxFile[];

      if (isTauri()) {
        setIngressAvailable(true);
        files = await readTauriInboxFiles();
      } else {
        const { files: fetched, gateOpen } = await fetchIngressFiles(cursorRef.current);
        setIngressAvailable(gateOpen);
        if (!gateOpen) return;
        files = fetched;
      }

      if (files.length === 0) return;

      const contentState = useContentStore.getState();
      const result = importHandoffFiles(files, {
        ideas: Object.values(contentState.ideas),
        pieces: Object.values(contentState.pieces),
        now: Date.now(),
        generateId,
      });

      if (result.ideasToCreate.length > 0 || result.piecesToUpsert.length > 0) {
        useContentStore.setState((s) => {
          const ideas = { ...s.ideas };
          for (const idea of result.ideasToCreate) ideas[idea.id] = idea;
          const pieces = { ...s.pieces };
          for (const piece of result.piecesToUpsert) pieces[piece.id] = piece;
          return { ideas, pieces };
        });

        await Promise.all(result.ideasToCreate.map((idea) => saveIdea(idea)));
        await Promise.all(result.piecesToUpsert.map((piece) => savePiece(piece)));
        await Promise.all(result.resourcesToCreate.map((resource) => saveResource(resource)));
      }

      const maxMtime = files.reduce((max, f) => Math.max(max, f.mtime), cursorRef.current ?? 0);
      cursorRef.current = maxMtime;

      if (result.acks.length > 0) {
        if (isTauri()) {
          await ackTauriImportedFiles(result.acks);
        } else {
          await ackIngress(result.acks);
        }
      }
    } catch {
      // Best-effort background sync — never surface an error to the user
      // for a missed poll; the next tick (or next visibility change) retries.
    } finally {
      runningRef.current = false;
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (timer) return;
      void refreshInbox();
      timer = setInterval(() => void refreshInbox(), POLL_INTERVAL_MS);
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
  }, [refreshInbox]);

  return { ingressAvailable, refreshInbox };
}
