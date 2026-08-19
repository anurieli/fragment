"use client";

import { useCallback, useRef, useState } from "react";
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
  type ExtractScope,
} from "@/lib/agents/extract";

export interface ExtractOutcome {
  created: number;
  truncated: boolean;
  /** What was read, in the user's words. */
  label: string;
}

/**
 * Run the idea extractor over whatever it was pointed at.
 *
 * The scope is always explicit. "The whole idea" and "this one draft" produce
 * different pieces from the same library, and an agent that will not say which
 * it read is one you cannot use with four drafts open.
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
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  // State updates are not synchronous. The ref closes the same-tick window in
  // which a second click could otherwise launch another paid request before
  // React has re-rendered the disabled controls.
  const activeRun = useRef(false);

  const extract = useCallback(async (scope: ExtractScope): Promise<ExtractOutcome | null> => {
    if (activeRun.current) return null;

    const content = useContentStore.getState();
    const ideaId =
      scope.kind === "idea" ? scope.ideaId : content.pieces[scope.pieceId]?.ideaId;
    const idea = ideaId ? content.ideas[ideaId] : undefined;
    if (!idea || !ideaId) return null;

    const source = buildExtractSource(
      idea,
      Object.values(content.pieces),
      Object.values(content.resources),
      scope,
    );
    if (!hasEnoughToExtract(source)) {
      useToastStore
        .getState()
        .showToast(
          scope.kind === "piece"
            ? "There is not enough written in this draft to pull pieces out of."
            : "Write more in this idea first. There is not enough here to pull pieces out of.",
        );
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

    activeRun.current = true;
    setActiveLabel(source.label);
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
          .showToast(`Nothing in ${source.label} stands on its own yet.`);
        return { created: 0, truncated: source.truncated, label: source.label };
      }

      createFromExtracted(ideaId, extracted);
      useToastStore
        .getState()
        .showToast(
          `${extracted.length} ${extracted.length === 1 ? "piece" : "pieces"} from ${source.label}, in the inbox.`,
        );
      return { created: extracted.length, truncated: source.truncated, label: source.label };
    } catch {
      useToastStore.getState().showToast("Could not reach your AI provider.");
      return null;
    } finally {
      activeRun.current = false;
      setActiveLabel(null);
      setIsExtracting(false);
    }
  }, []);

  return { extract, isExtracting, activeLabel };
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
