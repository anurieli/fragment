"use client";

import { useCallback } from "react";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useAppStore } from "@/stores/app-store";
import { logApiCall } from "@/lib/api-logger";
import { useToastStore } from "@/hooks/use-toast";
import { postLabel } from "@/lib/ai-client";
import { isAiAuthFailureStatus, resolveWorkingFeatureAuth } from "@/lib/ai/connection-status";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";

export function useLabelSnippet() {
  const updateSnippetLabel = useDataStore((s) => s.updateSnippetLabel);
  const settings = useSettingsStore((s) => s.settings);
  const updateProviderCredentials = useSettingsStore((s) => s.updateProviderCredentials);

  const labelSnippet = useCallback(
    async (
      snippetId: string,
      snippetContent: string,
      essayContent: string,
      goal: string,
      pieceId?: string,
    ) => {
      if (!settings.snippetLabeling.enabled) {
        updateSnippetLabel(snippetId, null, "idle");
        return;
      }

      // Background feature — the user didn't explicitly ask for AI here, so a
      // missing provider fails silently (no gate spam on every snippet). A
      // live auth failure below still opens the gate once.
      const app = useAppStore.getState();
      const auth = resolveWorkingFeatureAuth(settings, app.badProviders, "snippetLabeling");
      if (!auth) {
        updateSnippetLabel(snippetId, null, "idle");
        return;
      }

      try {
        const { provider, model } = auth;
        const { promptTemplate, maxEssayContext } = settings.snippetLabeling;
        const truncatedEssayContent =
          maxEssayContext > 0 ? essayContent.slice(0, maxEssayContext) : "";

        const buildBody = (codexToken: string | undefined) =>
          JSON.stringify({
            snippetContent,
            essayContent: truncatedEssayContent,
            goal,
            promptTemplate,
            model,
            provider,
            apiKey: auth.apiKey || undefined,
            codexToken,
          });

        // Proactive token validation (refreshes before expiry, shares ~/.codex/auth.json)
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
            updateSnippetLabel(snippetId, null, "error");
            return;
          }
          codexToken = token;
        }

        let res = await postLabel(buildBody(codexToken));

        // Fallback: force refresh on 401 (token invalidated between check and use)
        if (res.status === 401 && provider === "codex") {
          const fresh = await forceRefreshCodexToken(updateProviderCredentials);
          if (fresh) {
            res = await postLabel(buildBody(fresh));
          }
        }

        const data = await res.json();

        if (data._meta) {
          const modelUsed = (data._meta.modelUsed as string | undefined) || model;
          logApiCall("label", "snip", provider, modelUsed, data._meta, pieceId).catch(() => {});
        }

        if (!res.ok) {
          if (isAiAuthFailureStatus(res.status)) {
            app.markProviderBad(provider);
            app.openAiGate("auth-failed", provider);
          } else {
            useToastStore.getState().showToast("Labeling failed. Check your AI settings.");
          }
          updateSnippetLabel(snippetId, null, "error");
          return;
        }

        app.clearProviderBad(provider);
        updateSnippetLabel(snippetId, data.label, "done");
      } catch {
        useToastStore.getState().showToast("Labeling failed. Check your connection.");
        updateSnippetLabel(snippetId, null, "error");
      }
    },
    [updateSnippetLabel, settings, updateProviderCredentials],
  );

  return { labelSnippet };
}
