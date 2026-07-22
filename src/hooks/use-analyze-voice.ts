"use client";

import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { useAppStore } from "@/stores/app-store";
import { useToastStore } from "@/hooks/use-toast";
import { postAnalyzeVoice } from "@/lib/ai-client";
import { getProviderKey } from "@/lib/ai/provider-runtime";
import { hasWorkingProvider } from "@/lib/ai/connection-status";
import { loadSamplesForVoice } from "@/lib/persistence";
import { parseVoiceProfile, prepareSamplesForAnalysis } from "@/lib/voice-context";
import { logApiCall } from "@/lib/api-logger";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";

/**
 * Analyze a voice's samples into a VoiceProfile. Reads all state via getState()
 * so the call survives the caller unmounting — this is what makes onboarding's
 * fire-and-forget background analysis work. On failure the old profile is kept.
 */
export async function analyzeVoice(voiceId: string): Promise<boolean> {
  const voiceStore = useVoiceStore.getState();
  const voice = voiceStore.voices[voiceId];
  if (!voice) return false;

  const app = useAppStore.getState();

  // Re-entrancy guard: the UI button disables while analyzing, but this is also
  // invoked headlessly from onboarding, so nothing else stops two concurrent
  // runs for the same voice from racing their writes.
  if (app.voiceAnalysisStatus[voiceId] === "analyzing") return false;

  // Snapshot the edit clock. Any sample add/remove or description edit bumps
  // updatedAt (and sets profileStale), so if this changes mid-flight the result
  // is stale and must not clear the stale flag.
  const snapshotUpdatedAt = voice.updatedAt;

  const settings = useSettingsStore.getState();
  const { provider, model } = settings.settings.featureProviders.slashCommand;
  const { analysisPromptTemplate } = settings.settings.brandVoice;

  // Voice analysis reuses the slashCommand provider. Gate it on a working
  // provider like every other AI feature, so a no-provider / expired-key user
  // gets the connection gate instead of a silent toast-and-fail.
  if (!hasWorkingProvider(settings.settings, app.badProviders, "slashCommand")) {
    app.openAiGate("no-provider");
    useToastStore.getState().showToast("Connect an AI provider to analyze your voice.");
    app.setVoiceAnalysisStatus(voiceId, "error");
    return false;
  }

  app.setVoiceAnalysisStatus(voiceId, "analyzing");

  try {
    const samples = await loadSamplesForVoice(voiceId);
    if (samples.length === 0 && !voice.description.trim()) {
      useToastStore.getState().showToast("Add a sample or description before analyzing.");
      app.setVoiceAnalysisStatus(voiceId, "error");
      return false;
    }
    const samplesText = prepareSamplesForAnalysis(samples);

    const buildBody = (codexToken: string | undefined) =>
      JSON.stringify({
        voiceName: voice.name,
        description: voice.description,
        samplesText,
        promptTemplate: analysisPromptTemplate,
        model,
        provider,
        apiKey: getProviderKey(provider, settings.settings.providerCredentials) || undefined,
        codexToken,
      });

    let codexToken: string | undefined;
    if (provider === "codex") {
      const token = await ensureValidCodexToken(
        settings.settings.providerCredentials.codexAccessToken,
        settings.settings.providerCredentials.codexRefreshToken,
        settings.updateProviderCredentials,
      );
      if (!token) {
        app.markProviderBad("codex");
        app.openAiGate("auth-failed", "codex");
        useToastStore.getState().showToast("ChatGPT disconnected. Reconnect in Settings.");
        app.setVoiceAnalysisStatus(voiceId, "error");
        return false;
      }
      codexToken = token;
    }

    let res = await postAnalyzeVoice(buildBody(codexToken));
    if (res.status === 401 && provider === "codex") {
      const fresh = await forceRefreshCodexToken(settings.updateProviderCredentials);
      if (fresh) res = await postAnalyzeVoice(buildBody(fresh));
    }

    const data = await res.json();
    if (data._meta) {
      const modelUsed = (data._meta.modelUsed as string | undefined) || model;
      logApiCall("analyze", "brand-voice", provider, modelUsed, data._meta).catch(() => {});
    }

    if (!res.ok) {
      if (res.status === 401) {
        app.markProviderBad(provider);
        app.openAiGate("auth-failed", provider);
      }
      const toast = res.status === 401
        ? (provider === "codex" ? "ChatGPT disconnected. Reconnect in Settings." : "API key invalid. Check Settings.")
        : "Voice analysis failed. Check your AI settings.";
      useToastStore.getState().showToast(toast);
      app.setVoiceAnalysisStatus(voiceId, "error");
      return false;
    }

    const profile = parseVoiceProfile(typeof data.content === "string" ? data.content : "");
    if (!profile) {
      useToastStore.getState().showToast("Couldn't read the analysis result. Try again.");
      app.setVoiceAnalysisStatus(voiceId, "error");
      return false;
    }

    // Re-read the voice — it may have been deleted or edited during the request.
    const live = useVoiceStore.getState().voices[voiceId];
    if (!live) {
      app.setVoiceAnalysisStatus(voiceId, null);
      return false;
    }
    // If samples/description changed mid-flight, keep the fresh profile but leave
    // it flagged stale — the new content was never analyzed. Don't lie "fresh".
    const editedDuringFlight = live.updatedAt !== snapshotUpdatedAt;
    useVoiceStore.getState().updateBrandVoice(voiceId, {
      profile,
      profileStale: editedDuringFlight,
      profileUpdatedAt: Date.now(),
      analyzedSampleCount: samples.length,
    });
    app.setVoiceAnalysisStatus(voiceId, null);
    return true;
  } catch {
    useToastStore.getState().showToast("Voice analysis failed. Check your connection.");
    app.setVoiceAnalysisStatus(voiceId, "error");
    return false;
  }
}
