"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isTauri } from "@/lib/ai-client";
import {
  importHandoffFiles,
  importIdeaFiles,
  importResourceLines,
  type AgentIdeaFile,
  type AgentInboxFile,
  type AgentResourceFile,
} from "@/lib/agent-inbox/import";
import { ackTauriImportedFiles, readTauriIdeaFiles, readTauriInboxFiles, readTauriResourceFiles } from "@/lib/agent-inbox/tauri-inbox";
import { generateId } from "@/lib/utils";
import { saveIdea, savePiece, saveResource } from "@/lib/persistence";
import { useContentStore } from "@/stores/content-store";

const POLL_INTERVAL_MS = 10_000;

async function fetchIngressFiles(sinceMs: number | undefined): Promise<{
  files: AgentInboxFile[];
  resourceFiles: AgentResourceFile[];
  ideaFiles: AgentIdeaFile[];
  gateOpen: boolean;
}> {
  const params = new URLSearchParams();
  if (sinceMs !== undefined) params.set("since", String(sinceMs));
  const query = params.toString();

  const res = await fetch(`/api/v1/agent-inbox${query ? `?${query}` : ""}`);
  if (res.status === 404) {
    return { files: [], resourceFiles: [], ideaFiles: [], gateOpen: false };
  }
  if (!res.ok) {
    return { files: [], resourceFiles: [], ideaFiles: [], gateOpen: true };
  }
  const body = (await res.json()) as {
    files: AgentInboxFile[];
    resourceFiles: AgentResourceFile[];
    ideaFiles?: AgentIdeaFile[];
  };
  return { files: body.files, resourceFiles: body.resourceFiles, ideaFiles: body.ideaFiles ?? [], gateOpen: true };
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
      let resourceFiles: AgentResourceFile[];
      let ideaFiles: AgentIdeaFile[];

      if (isTauri()) {
        setIngressAvailable(true);
        [files, resourceFiles, ideaFiles] = await Promise.all([
          readTauriInboxFiles(),
          readTauriResourceFiles(),
          readTauriIdeaFiles(),
        ]);
      } else {
        const fetched = await fetchIngressFiles(cursorRef.current);
        setIngressAvailable(fetched.gateOpen);
        if (!fetched.gateOpen) return;
        files = fetched.files;
        resourceFiles = fetched.resourceFiles;
        ideaFiles = fetched.ideaFiles;
      }

      if (files.length === 0 && resourceFiles.length === 0 && ideaFiles.length === 0) return;

      const contentState = useContentStore.getState();

      // Idea manifests first, so pieces in this same batch that reference an
      // agent-created ideaId resolve instead of erroring.
      const ideaResult = importIdeaFiles(ideaFiles, {
        existingIdeaIds: new Set(Object.keys(contentState.ideas)),
        now: Date.now(),
      });

      const result = importHandoffFiles(files, {
        ideas: [...Object.values(contentState.ideas), ...ideaResult.ideasToCreate],
        pieces: Object.values(contentState.pieces),
        now: Date.now(),
        generateId,
      });
      const resourceResult = importResourceLines(resourceFiles, {
        existingResourceIds: new Set(Object.keys(contentState.resources)),
        now: Date.now(),
        generateId,
      });

      const allNewIdeas = [...ideaResult.ideasToCreate, ...result.ideasToCreate];
      if (
        allNewIdeas.length > 0 ||
        result.piecesToUpsert.length > 0 ||
        resourceResult.resourcesToUpsert.length > 0
      ) {
        useContentStore.setState((s) => {
          const ideas = { ...s.ideas };
          for (const idea of allNewIdeas) ideas[idea.id] = idea;
          const pieces = { ...s.pieces };
          for (const piece of result.piecesToUpsert) pieces[piece.id] = piece;
          const resources = { ...s.resources };
          for (const resource of result.resourcesToCreate) resources[resource.id] = resource;
          for (const resource of resourceResult.resourcesToUpsert) resources[resource.id] = resource;
          return { ideas, pieces, resources };
        });

        await Promise.all(allNewIdeas.map((idea) => saveIdea(idea)));
        await Promise.all(result.piecesToUpsert.map((piece) => savePiece(piece)));
        await Promise.all(result.resourcesToCreate.map((resource) => saveResource(resource)));
        await Promise.all(resourceResult.resourcesToUpsert.map((resource) => saveResource(resource)));
      }

      const maxMtime = files.reduce((max, f) => Math.max(max, f.mtime), cursorRef.current ?? 0);
      cursorRef.current = maxMtime;

      const allAcks = [...result.acks, ...resourceResult.acks];
      if (allAcks.length > 0) {
        if (isTauri()) {
          await ackTauriImportedFiles(allAcks);
        } else {
          await ackIngress(allAcks);
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
