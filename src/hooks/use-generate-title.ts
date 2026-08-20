"use client";

import { useCallback, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useContentStore } from "@/stores/content-store";
import { useAppStore } from "@/stores/app-store";
import { useToastStore } from "@/hooks/use-toast";
import { postGenerate } from "@/lib/ai-client";
import { isAiAuthFailureStatus, resolveWorkingFeatureAuth } from "@/lib/ai/connection-status";
import { DEFAULT_TITLE_PROMPT } from "@/lib/defaults";
import { cleanGeneratedTitle, titleContext } from "@/lib/note-title";
import { logApiCall } from "@/lib/api-logger";
import { captureEvent } from "@/lib/posthog";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";
import { briefForPiece } from "@/hooks/use-brief";
import { composeVoiceContext } from "@/lib/voice-context";

/**
 * Titles a fragment from what is already in it: the draft plus its resolved
 * brief (goal, audience, tone, remember — the fragment's own, else its idea's,
 * else its voice's) and that voice. One shot,
 * non-streaming: a title is a few words, so there is nothing to watch arrive.
 *
 * Reuses the slashCommand provider and gate the way voice analysis does
 * (use-analyze-voice.ts): this is the same "generate" route, and a user who
 * has connected one provider should not have to connect a second one to name
 * a draft. State is read through getState() so the call survives the header
 * re-rendering underneath it.
 */
export function useGenerateTitle() {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateTitle = useCallback(async (pieceId: string, content: string): Promise<void> => {
    const piece = useContentStore.getState().pieces[pieceId];
    if (!piece) return;

    const draft = titleContext(content || piece.body);
    if (!draft) {
      useToastStore.getState().showToast("Write something first, then generate a title.");
      return;
    }

    const { brief, voice } = briefForPiece(piece);

    const app = useAppStore.getState();
    const settingsStore = useSettingsStore.getState();
    const settings = settingsStore.settings;

    const auth = resolveWorkingFeatureAuth(settings, app.badProviders, "slashCommand");
    if (!auth) {
      app.openAiGate("no-provider");
      useToastStore.getState().showToast("Connect an AI provider to generate a title.");
      return;
    }

    const { provider, model } = auth;
    const buildBody = (codexToken: string | undefined) =>
      JSON.stringify({
        contextAbove: draft,
        goal: brief.goal,
        audience: brief.audience,
        tone: brief.tone,
        remember: brief.remember,
        voiceContext: composeVoiceContext(voice) || undefined,
        promptTemplate: DEFAULT_TITLE_PROMPT,
        model,
        provider,
        apiKey: auth.apiKey || undefined,
        codexToken,
      });

    setIsGenerating(true);
    try {
      let codexToken: string | undefined;
      if (provider === "codex") {
        const token = await ensureValidCodexToken(
          settings.providerCredentials.codexAccessToken,
          settings.providerCredentials.codexRefreshToken,
          settingsStore.updateProviderCredentials,
        );
        if (!token) {
          app.markProviderBad("codex");
          app.openAiGate("auth-failed", "codex");
          useToastStore.getState().showToast("ChatGPT disconnected. Reconnect in Settings.");
          return;
        }
        codexToken = token;
      }

      let res = await postGenerate(buildBody(codexToken));
      if (res.status === 401 && provider === "codex") {
        const fresh = await forceRefreshCodexToken(settingsStore.updateProviderCredentials);
        if (fresh) res = await postGenerate(buildBody(fresh));
      }

      const data = await res.json();
      if (data._meta) {
        const modelUsed = (data._meta.modelUsed as string | undefined) || model;
        logApiCall("generate", "title", provider, modelUsed, data._meta, pieceId).catch(() => {});
      }

      if (!res.ok) {
        if (isAiAuthFailureStatus(res.status)) {
          app.markProviderBad(provider);
          app.openAiGate("auth-failed", provider);
        }
        useToastStore.getState().showToast(
          isAiAuthFailureStatus(res.status)
            ? (provider === "codex" ? "ChatGPT disconnected. Reconnect in Settings." : "API key invalid. Check Settings.")
            : "Couldn't generate a title. Check your AI settings.",
        );
        return;
      }

      app.clearProviderBad(provider);

      const title = cleanGeneratedTitle(typeof data.content === "string" ? data.content : "");
      if (!title) {
        useToastStore.getState().showToast("Couldn't read the generated title. Try again.");
        return;
      }

      // Re-read the fragment: it may have been deleted while the request was out.
      if (!useContentStore.getState().pieces[pieceId]) return;
      useContentStore.getState().updatePiece(pieceId, { title });
      captureEvent("note_title_generated", { model });
    } catch {
      useToastStore.getState().showToast("Couldn't generate a title. Check your connection.");
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { generateTitle, isGenerating };
}
