"use client";

import { useCallback, useState } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useDataStore } from "@/stores/data-store";
import { useAppStore } from "@/stores/app-store";
import { useToastStore } from "@/hooks/use-toast";
import { postGenerate } from "@/lib/ai-client";
import { getProviderKey } from "@/lib/ai/provider-runtime";
import { hasWorkingProvider } from "@/lib/ai/connection-status";
import { DEFAULT_TITLE_PROMPT } from "@/lib/defaults";
import { cleanGeneratedTitle, titleContext } from "@/lib/note-title";
import { logApiCall } from "@/lib/api-logger";
import { captureEvent } from "@/lib/posthog";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";

/**
 * Titles a note from what is already in it: the draft plus the note's own
 * context fields (goal, audience, tone, remember). One shot, non-streaming:
 * a title is a few words, so there is nothing to watch arrive.
 *
 * Reuses the slashCommand provider and gate the way voice analysis does
 * (use-analyze-voice.ts): this is the same "generate" route, and a user who
 * has connected one provider should not have to connect a second one to name
 * a note. State is read through getState() so the call survives the header
 * re-rendering underneath it.
 */
export function useGenerateTitle() {
  const [isGenerating, setIsGenerating] = useState(false);

  const generateTitle = useCallback(async (noteId: string, content: string): Promise<void> => {
    const dataStore = useDataStore.getState();
    const note = dataStore.notes[noteId];
    if (!note) return;

    const draft = titleContext(content || note.content);
    if (!draft) {
      useToastStore.getState().showToast("Write something first, then generate a title.");
      return;
    }

    const app = useAppStore.getState();
    const settingsStore = useSettingsStore.getState();
    const settings = settingsStore.settings;

    if (!hasWorkingProvider(settings, app.badProviders, "slashCommand")) {
      app.openAiGate("no-provider");
      useToastStore.getState().showToast("Connect an AI provider to generate a title.");
      return;
    }

    const { provider, model } = settings.featureProviders.slashCommand;
    const buildBody = (codexToken: string | undefined) =>
      JSON.stringify({
        contextAbove: draft,
        goal: note.goal,
        audience: note.audience,
        tone: note.tone,
        remember: note.remember,
        promptTemplate: DEFAULT_TITLE_PROMPT,
        model,
        provider,
        apiKey: getProviderKey(provider, settings.providerCredentials) || undefined,
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
        logApiCall("generate", "title", provider, modelUsed, data._meta, noteId).catch(() => {});
      }

      if (!res.ok) {
        if (res.status === 401) {
          app.markProviderBad(provider);
          app.openAiGate("auth-failed", provider);
        }
        useToastStore.getState().showToast(
          res.status === 401
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

      // Re-read the note: it may have been deleted while the request was out.
      if (!useDataStore.getState().notes[noteId]) return;
      useDataStore.getState().updateNoteTitle(noteId, title);
      captureEvent("note_title_generated", { model });
    } catch {
      useToastStore.getState().showToast("Couldn't generate a title. Check your connection.");
    } finally {
      setIsGenerating(false);
    }
  }, []);

  return { generateTitle, isGenerating };
}
