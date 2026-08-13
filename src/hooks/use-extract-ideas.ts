"use client";

import { useCallback, useState } from "react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useToastStore } from "@/hooks/use-toast";
import { postExtract } from "@/lib/ai-client";
import { resolveWorkingFeatureAuth } from "@/lib/ai/connection-status";
import { ensureValidCodexToken } from "@/lib/codex-token-manager";
import { inheritedBrief } from "@/lib/brief-context";
import { resolveVoice } from "@/lib/voice-context";
import { useVoiceStore } from "@/stores/voice-store";
import {
  buildExtractSource,
  hasEnoughToExtract,
  parseExtracted,
  type ExtractedPiece,
} from "@/lib/agents/extract";

export interface ExtractOutcome {
  created: number;
  truncated: boolean;
}

/**
 * Run the idea extractor over one idea.
 *
 * Everything it creates lands in that idea's inbox, unpublished and untriaged,
 * which is where agent-pushed work already arrives. That is deliberate: this
 * agent writes several pieces at once from material you did not re-read first,
 * and dropping them straight into the ready queue would mean trusting output
 * nobody has looked at. The inbox is the surface built for exactly that
 * doubt, and Dismiss is one click.
 */
export function useExtractIdeas() {
  const [isExtracting, setIsExtracting] = useState(false);

  const extract = useCallback(async (ideaId: string): Promise<ExtractOutcome | null> => {
    const content = useContentStore.getState();
    const idea = content.ideas[ideaId];
    if (!idea) return null;

    const source = buildExtractSource(
      idea,
      Object.values(content.pieces),
      Object.values(content.resources),
    );
    if (!hasEnoughToExtract(source)) {
      useToastStore
        .getState()
        .showToast("Write more in this idea first. There is not enough here to pull pieces out of.");
      return null;
    }

    const app = useAppStore.getState();
    const settingsStore = useSettingsStore.getState();
    const settings = settingsStore.settings;

    const auth = resolveWorkingFeatureAuth(settings, app.badProviders, "ideaExtractor");
    if (!auth) {
      app.openAiGate("no-provider");
      useToastStore.getState().showToast("Connect an AI provider to extract pieces.");
      return null;
    }

    const voice = resolveVoice(
      useVoiceStore.getState().voices,
      settings.brandVoice.defaultVoiceId,
      idea.voiceId,
    );
    const brief = inheritedBrief("idea", { idea, voice });

    setIsExtracting(true);
    try {
      let codexToken: string | undefined;
      if (auth.provider === "codex") {
        codexToken = (await ensureValidCodexToken(
          settings.providerCredentials.codexAccessToken,
          settings.providerCredentials.codexRefreshToken,
          settingsStore.updateProviderCredentials,
        )) ?? undefined;
      }

      const res = await postExtract(
        JSON.stringify({
          source: source.text,
          // .value on each: a resolved brief field carries where it came from
          // alongside what it says, and sending the whole record puts
          // "[object Object]" in the prompt where the goal should be.
          goal: brief.goal.value,
          audience: brief.audience.value,
          tone: brief.tone.value,
          remember: brief.remember.value,
          promptTemplate: settings.ideaExtractor.promptTemplate,
          model: auth.model,
          provider: auth.provider,
          apiKey: auth.apiKey || undefined,
          codexToken,
        }),
      );

      const payload = (await res.json()) as { content?: string; error?: string };
      if (!res.ok) {
        useToastStore.getState().showToast(payload.error || "Extraction failed.");
        return null;
      }

      const extracted = parseExtracted(payload.content ?? "");
      if (extracted === null) {
        // The call succeeded and cost money; saying so beats a silent no-op.
        useToastStore
          .getState()
          .showToast("The model did not answer in a shape Fragment could read. Try again.");
        return null;
      }
      if (extracted.length === 0) {
        useToastStore
          .getState()
          .showToast("Nothing in this idea stands on its own yet.");
        return { created: 0, truncated: source.truncated };
      }

      createFromExtracted(ideaId, extracted);
      useToastStore
        .getState()
        .showToast(
          `${extracted.length} ${extracted.length === 1 ? "piece" : "pieces"} in the inbox.`,
        );
      return { created: extracted.length, truncated: source.truncated };
    } catch {
      useToastStore.getState().showToast("Could not reach your AI provider.");
      return null;
    } finally {
      setIsExtracting(false);
    }
  }, []);

  return { extract, isExtracting };
}

function createFromExtracted(ideaId: string, extracted: readonly ExtractedPiece[]): void {
  const store = useContentStore.getState();
  for (const piece of extracted) {
    store.createPiece({
      ideaId,
      title: piece.title || undefined,
      body: piece.body,
      format: "linkedin",
      status: "inbox",
      origin: "agent",
    });
  }
}
