"use client";

import { useCallback, useRef } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { useAppStore } from "@/stores/app-store";
import { useToastStore } from "@/hooks/use-toast";
import { postGenerateStream } from "@/lib/ai-client";
import { resolveVoice, composeVoiceContext } from "@/lib/voice-context";
import { isAiAuthFailureStatus, resolveWorkingFeatureAuth } from "@/lib/ai/connection-status";
import { parseSSEStreamWithUsage } from "@/lib/sse-parser";
import { logApiCall } from "@/lib/api-logger";
import { captureEvent } from "@/lib/posthog";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";

export interface StreamCallbacks {
  onChunk: (accumulated: string) => void;
  onDone: (final: string) => void;
  onError: (message: string) => void;
}

// NOTE FOR CALLERS: an aborted generation settles NEITHER callback. Both abort
// paths below (an AbortError thrown mid-request, and the post-loop
// `if (!signal.aborted)` guard) return silently, by design — abort is the
// caller's own doing, so it isn't an error and there's no final text to hand
// back. The consequence is that anything you flip on before calling
// generateStream must be flipped off from the returned promise's `.finally`,
// never from onDone/onError alone. `flowGenerating` in piece-card.tsx was
// cleared in the callbacks and stayed stuck on, holding the piece read-only
// until the page was reloaded (ARI-184).

export function useSlashCommand() {
  const settings = useSettingsStore((s) => s.settings);
  const updateProviderCredentials = useSettingsStore((s) => s.updateProviderCredentials);
  const abortRef = useRef<AbortController | null>(null);

  const generateStream = useCallback(
    async (
      contextAbove: string,
      contextBelow: string,
      goal: string,
      audience: string,
      tone: string,
      remember: string,
      userInstruction: string,
      callbacks: StreamCallbacks,
      noteId?: string,
      voiceId?: string | null,
    ): Promise<void> => {
      if (!settings.slashCommand.enabled) {
        callbacks.onError("Slash commands disabled");
        return;
      }

      const app = useAppStore.getState();
      const auth = resolveWorkingFeatureAuth(settings, app.badProviders, "slashCommand");
      if (!auth) {
        app.openAiGate("no-provider");
        callbacks.onError("No AI provider connected");
        return;
      }

      const { voices } = useVoiceStore.getState();
      const voiceContext = composeVoiceContext(
        resolveVoice(voices, settings.brandVoice.defaultVoiceId, voiceId),
      );

      // Cancel any in-flight generation
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      const { provider, model } = auth;
      const { maxContextAbove, maxContextBelow, promptTemplate } =
        settings.slashCommand;
      const apiKey = auth.apiKey || undefined;
      const promptLength =
        contextAbove.slice(-maxContextAbove).length
        + contextBelow.slice(0, maxContextBelow).length
        + (goal?.length ?? 0)
        + (userInstruction?.length ?? 0);
      const buildBody = (codexToken: string | undefined) =>
        JSON.stringify({
          contextAbove: contextAbove.slice(-maxContextAbove),
          contextBelow: contextBelow.slice(0, maxContextBelow),
          goal,
          audience,
          tone,
          remember,
          userInstruction,
          promptTemplate,
          voiceContext,
          model,
          provider,
          apiKey,
          codexToken,
        });

      const startTime = Date.now();

      try {
        // Proactive token validation
        let codexToken: string | undefined;
        if (provider === "codex") {
          const token = await ensureValidCodexToken(
            settings.providerCredentials.codexAccessToken,
            settings.providerCredentials.codexRefreshToken,
            updateProviderCredentials,
          );
          if (!token) {
            app.markProviderBad("codex");
            app.openAiGate("auth-failed", "codex");
            callbacks.onError("ChatGPT disconnected");
            return;
          }
          codexToken = token;
        }

        let res = await postGenerateStream(buildBody(codexToken), { signal });

        // Fallback: force refresh on 401
        if (res.status === 401 && provider === "codex") {
          const fresh = await forceRefreshCodexToken(updateProviderCredentials);
          if (fresh) {
            res = await postGenerateStream(buildBody(fresh), { signal });
          }
        }

        if (!res.ok || !res.body) {
          const durationMs = Date.now() - startTime;
          const isAuthFailure = isAiAuthFailureStatus(res.status);
          const message = isAuthFailure
            ? (provider === "codex" ? "ChatGPT disconnected." : "API key invalid.")
            : "Generation failed. Check your AI settings.";
          if (isAuthFailure) {
            app.markProviderBad(provider);
            app.openAiGate("auth-failed", provider);
          } else {
            useToastStore.getState().showToast(message);
          }
          logApiCall("generate", "flow", provider, model, {
            durationMs,
            statusCode: res.status,
            error: message,
            promptLength,
            responseLength: 0,
          }, noteId).catch(() => {});
          callbacks.onError(message);
          return;
        }

        app.clearProviderBad(provider);

        let accumulated = "";
        let rafId: number | null = null;
        let pendingContent: string | null = null;

        const scheduleUpdate = (content: string) => {
          pendingContent = content;
          if (rafId === null) {
            rafId = requestAnimationFrame(() => {
              rafId = null;
              if (pendingContent !== null) {
                callbacks.onChunk(pendingContent);
              }
            });
          }
        };

        const { stream, getUsage } = parseSSEStreamWithUsage(res.body);

        for await (const chunk of stream) {
          if (signal.aborted) break;
          accumulated += chunk;
          scheduleUpdate(accumulated);
        }

        if (rafId !== null) cancelAnimationFrame(rafId);

        if (!signal.aborted) {
          const durationMs = Date.now() - startTime;
          const usage = getUsage();
          logApiCall("generate", "flow", provider, model, {
            durationMs,
            statusCode: 200,
            promptLength,
            responseLength: accumulated.length,
            promptTokens: usage?.promptTokens,
            completionTokens: usage?.completionTokens,
            totalTokens: usage?.totalTokens,
          }, noteId).catch(() => {});
          captureEvent("slash_command_used", { model });
          callbacks.onDone(accumulated);
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        const durationMs = Date.now() - startTime;
        logApiCall("generate", "flow", provider, model, {
          durationMs,
          statusCode: 0,
          error: "Generation failed",
          promptLength,
          responseLength: 0,
        }, noteId).catch(() => {});
        useToastStore.getState().showToast("Generation failed. Check your connection.");
        callbacks.onError("Generation failed");
      }
    },
    [settings, updateProviderCredentials],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { generateStream, abort, enabled: settings.slashCommand.enabled };
}
