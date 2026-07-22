"use client";

import { useCallback } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { useAppStore } from "@/stores/app-store";
import { logApiCall } from "@/lib/api-logger";
import { captureEvent } from "@/lib/posthog";
import { useToastStore } from "@/hooks/use-toast";
import { postEdit } from "@/lib/ai-client";
import { getProviderKey } from "@/lib/ai/provider-runtime";
import { resolveVoice, composeVoiceContext } from "@/lib/voice-context";
import { hasWorkingProvider } from "@/lib/ai/connection-status";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";

export function useInlineEdit() {
  const settings = useSettingsStore((s) => s.settings);
  const updateProviderCredentials = useSettingsStore((s) => s.updateProviderCredentials);

  const edit = useCallback(
    async (
      selectedText: string,
      contextBefore: string,
      contextAfter: string,
      goal: string,
      audience: string,
      tone: string,
      remember: string,
      instruction: string,
      noteId?: string,
      voiceId?: string | null,
    ): Promise<string | null> => {
      if (!settings.inlineEdit.enabled) return null;

      const app = useAppStore.getState();
      if (!hasWorkingProvider(settings, app.badProviders, "inlineEdit")) {
        app.openAiGate("no-provider");
        return null;
      }

      const { provider, model } = settings.featureProviders.inlineEdit;
      const { maxContextChars, promptTemplate } = settings.inlineEdit;
      const apiKey = getProviderKey(provider, settings.providerCredentials) || undefined;

      const { voices } = useVoiceStore.getState();
      const voiceContext = composeVoiceContext(
        resolveVoice(voices, settings.brandVoice.defaultVoiceId, voiceId),
      );

      const buildBody = (codexToken: string | undefined) =>
        JSON.stringify({
          selectedText,
          contextBefore: contextBefore.slice(-maxContextChars),
          contextAfter: contextAfter.slice(0, maxContextChars),
          goal,
          audience,
          tone,
          remember,
          instruction,
          promptTemplate,
          voiceContext,
          model,
          provider,
          apiKey,
          codexToken,
        });

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
            return null;
          }
          codexToken = token;
        }

        let res = await postEdit(buildBody(codexToken));

        // Fallback: force refresh on 401
        if (res.status === 401 && provider === "codex") {
          const fresh = await forceRefreshCodexToken(updateProviderCredentials);
          if (fresh) {
            res = await postEdit(buildBody(fresh));
          }
        }

        const data = await res.json();

        if (data._meta) {
          const modelUsed = (data._meta.modelUsed as string | undefined) || model;
          logApiCall("edit", "refine", provider, modelUsed, data._meta, noteId).catch(() => {});
        }

        if (!res.ok) {
          if (res.status === 401) {
            app.markProviderBad(provider);
            app.openAiGate("auth-failed", provider);
          } else {
            useToastStore.getState().showToast("Edit failed. Check your AI settings.");
          }
          return null;
        }
        app.clearProviderBad(provider);
        captureEvent("inline_edit_used", { editType: instruction });
        return data.content || null;
      } catch {
        useToastStore.getState().showToast("Edit failed. Check your connection.");
        return null;
      }
    },
    [settings, updateProviderCredentials],
  );

  return { edit, enabled: settings.inlineEdit.enabled };
}
