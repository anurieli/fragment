"use client";

import { useCallback, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import type { ContentPiece } from "@/lib/content-engine";
import { useSettingsStore, waitForSettingsHydration } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { resolveVoice, composeVoiceContext } from "@/lib/voice-context";
import { briefForPiece } from "@/hooks/use-brief";
import { useToastStore } from "@/hooks/use-toast";
import { postGenerateStream } from "@/lib/ai-client";
import { isAiAuthFailureStatus, resolveWorkingFeatureAuth } from "@/lib/ai/connection-status";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";
import { parseSSEStreamWithUsage } from "@/lib/sse-parser";
import { logApiCall } from "@/lib/api-logger";
import { buildNoteCreationPrompt, type GenerateFormat, type GenerateLength } from "@/lib/defaults";
import { buildIdeaBrief } from "@/lib/ai-context";
import { effectiveResourcesForIdea } from "@/stores/resources-selectors";

/** Extract a leading H1 from markdown, returning the title and remaining content. */
function extractH1(markdown: string): { title: string; content: string } {
  const match = markdown.match(/^#\s+(.+)\n?/);
  if (!match) return { title: "", content: markdown };
  return { title: match[1].trim(), content: markdown.slice(match[0].length).trimStart() };
}


function getAIConfig(badProviders: ReadonlySet<import("@/lib/types").AIProvider>) {
  const s = useSettingsStore.getState().settings;
  const auth = resolveWorkingFeatureAuth(s, badProviders, "slashCommand");
  if (!auth) return null;
  return {
    provider: auth.provider,
    model: auth.model,
    apiKey: auth.apiKey || undefined,
    codexToken: s.providerCredentials.codexAccessToken || undefined,
    codexRefreshToken: s.providerCredentials.codexRefreshToken || undefined,
  };
}

export interface StreamGenerationParams {
  prompt: string;
  goal: string;
  audience: string;
  tone: string;
  remember: string;
  /** If provided, stream into this existing fragment instead of creating one. */
  existingPieceId?: string;
  /** Voice to apply. undefined = inherit default, null = no voice, string = specific voice. */
  voiceId?: string | null;
  /** Document shape and target length. Ephemeral generation params, not fragment
   * fields: they steer the prompt template and are forgotten after the run. */
  format?: GenerateFormat;
  length?: GenerateLength;
}

export function useStreamGeneration() {
  const abortRef = useRef<AbortController | null>(null);
  const titleSetRef = useRef(false);

  const startGeneration = useCallback(async (params: StreamGenerationParams) => {
    const { prompt, goal, audience, tone, remember, existingPieceId, voiceId, format, length } = params;

    const { createPiece, createIdeaWithFragment, updatePiece } = useContentStore.getState();

    const {
      setActivePiece,
      setActiveIdea,
      setGeneratingPiece,
      setStreamingContent,
      setStreamingError,
      dismissContextPrompt,
    } = useAppStore.getState();

    const updateProviderCredentials = useSettingsStore.getState().updateProviderCredentials;

    // Cancel any existing generation
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    titleSetRef.current = false;

    // 1. Create the fragment (or use existing) and navigate immediately
    let pieceId: string;
    if (existingPieceId) {
      pieceId = existingPieceId;
    } else {
      // Generated inside an open idea, so it belongs to that idea. With no
      // idea open there is nothing to put it in, and every fragment has to
      // live somewhere, so one is made for it.
      const ideaId = useAppStore.getState().activeIdeaId;
      if (ideaId) {
        pieceId = createPiece({
          ideaId,
          format: "essay",
          origin: "user",
          status: "in-progress",
          seen: true,
        });
      } else {
        const created = createIdeaWithFragment();
        pieceId = created.pieceId;
        if (created.ideaId) setActiveIdea(created.ideaId);
      }
    }

    if (!pieceId) {
      setStreamingError("Couldn't start a new draft");
      return;
    }

    // Set metadata
    const brief: Partial<Omit<ContentPiece, "id" | "createdAt">> = {};
    if (goal) brief.goal = goal;
    if (audience) brief.audience = audience;
    if (tone) brief.tone = tone;
    if (remember) brief.remember = remember;
    if (voiceId !== undefined) brief.voiceId = voiceId;
    if (Object.keys(brief).length > 0) updatePiece(pieceId, brief);

    // Dismiss context tooltip so it doesn't obscure streaming text
    dismissContextPrompt(pieceId);

    // Set streaming state BEFORE navigating so the editor knows it's generating
    setGeneratingPiece(pieceId);
    setStreamingContent("");
    setStreamingError(null);

    // Navigate to the fragment (closes creation flow)
    if (!existingPieceId) {
      setActivePiece(pieceId);
    }

    // 2. Build request and start streaming
    await waitForSettingsHydration();
    const app = useAppStore.getState();
    const ai = getAIConfig(app.badProviders);
    if (!ai) {
      app.openAiGate("no-provider");
      setStreamingError("No AI provider connected");
      setGeneratingPiece(null);
      setStreamingContent(null);
      return;
    }
    // What this generation is standing next to. Assembled at send time rather
    // than at creation time, so a fragment that has sat in an idea for a week
    // is briefed on what the idea holds now, not on what it held then.
    const content = useContentStore.getState();
    const generatedPiece = content.pieces[pieceId];
    const briefIdeaId = generatedPiece?.ideaId;
    const ideaBrief = buildIdeaBrief({
      idea: briefIdeaId ? content.ideas[briefIdeaId] ?? null : null,
      siblings: briefIdeaId
        ? Object.values(content.pieces).filter(
            (p) => p.ideaId === briefIdeaId && p.id !== pieceId && p.deletedAt === undefined,
          )
        : [],
      resources: briefIdeaId
        ? effectiveResourcesForIdea(
            briefIdeaId,
            Object.values(content.ideas),
            Object.values(content.resources),
          )
        : [],
    });

    // What the panel left blank is not blank: it falls through to the idea and
    // then to the voice (see lib/brief-context.ts). Resolved here, after the
    // typed values have been written onto the fragment, so the request carries
    // the same brief the editor shows.
    const resolved = generatedPiece
      ? briefForPiece(generatedPiece)
      : {
          brief: { goal, audience, tone, remember },
          voice: resolveVoice(
            useVoiceStore.getState().voices,
            useSettingsStore.getState().settings.brandVoice.defaultVoiceId,
            voiceId,
          ),
        };
    const effective = resolved.brief;

    const briefLength = ideaBrief.length;
    const promptLength =
      prompt.length + briefLength + effective.goal.length + effective.audience.length
      + effective.tone.length + effective.remember.length;

    const voiceContext = composeVoiceContext(resolved.voice);

    const buildBody = (token: string | undefined) =>
      JSON.stringify({
        contextAbove: ideaBrief,
        contextBelow: "",
        goal: effective.goal,
        audience: effective.audience,
        tone: effective.tone,
        remember: effective.remember,
        userInstruction: prompt,
        promptTemplate: buildNoteCreationPrompt(format ?? "freeform", length ?? "auto"),
        voiceContext,
        model: ai.model,
        provider: ai.provider,
        apiKey: ai.apiKey,
        codexToken: token,
      });

    let accumulated = "";
    let rafId: number | null = null;
    let pendingContent: string | null = null;
    const startTime = Date.now();

    // Throttled store update via requestAnimationFrame
    const scheduleUpdate = (content: string) => {
      pendingContent = content;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null;
          if (pendingContent !== null) {
            setStreamingContent(pendingContent);
          }
        });
      }
    };

    try {
      // Proactive token validation (refreshes before expiry, shares ~/.codex/auth.json)
      let codexToken = ai.codexToken;
      if (ai.provider === "codex") {
        const token = await ensureValidCodexToken(
          ai.codexToken || "",
          ai.codexRefreshToken || "",
          updateProviderCredentials,
        );
        if (!token) {
          app.markProviderBad("codex");
          app.openAiGate("auth-failed", "codex");
          setStreamingError("ChatGPT disconnected");
          setGeneratingPiece(null);
          setStreamingContent(null);
          return;
        }
        codexToken = token;
      }

      let res = await postGenerateStream(buildBody(codexToken), { signal });

      // Fallback: force refresh on 401 (token invalidated between check and use)
      if (res.status === 401 && ai.provider === "codex") {
        const fresh = await forceRefreshCodexToken(updateProviderCredentials);
        if (fresh) {
          res = await postGenerateStream(buildBody(fresh), { signal });
        }
      }

      if (!res.ok || !res.body) {
        const durationMs = Date.now() - startTime;
        const errorText = res.body
          ? await res.text().catch(() => "Generation failed")
          : "Generation failed";
        setStreamingError(errorText);
        setGeneratingPiece(null);
        setStreamingContent(null);
        const isAuthFailure = isAiAuthFailureStatus(res.status);
        if (isAuthFailure) {
          app.markProviderBad(ai.provider);
          app.openAiGate("auth-failed", ai.provider);
        } else {
          useToastStore.getState().showToast("Generation failed. Check your AI settings.");
        }
        logApiCall("generate", "flow-create", ai.provider, ai.model, {
          durationMs,
          statusCode: res.status,
          error: isAuthFailure ? "AI connection needs to be reconnected" : errorText,
          promptLength,
          responseLength: 0,
        }, pieceId).catch(() => {});
        return;
      }

      app.clearProviderBad(ai.provider);

      // 3. Consume the stream
      const { stream, getUsage } = parseSSEStreamWithUsage(res.body);

      for await (const chunk of stream) {
        if (signal.aborted) break;

        accumulated += chunk;
        scheduleUpdate(accumulated);

        // Incremental H1 title extraction
        if (!titleSetRef.current) {
          const titleMatch = accumulated.match(/^#\s+(.+)\n/);
          if (titleMatch) {
            updatePiece(pieceId, { title: titleMatch[1].trim() });
            titleSetRef.current = true;
          }
        }
      }

      // 4. Finalize
      if (rafId !== null) cancelAnimationFrame(rafId);

      if (!signal.aborted) {
        const durationMs = Date.now() - startTime;
        const usage = getUsage();
        logApiCall("generate", "flow-create", ai.provider, ai.model, {
          durationMs,
          statusCode: 200,
          promptLength,
          responseLength: accumulated.length,
          promptTokens: usage?.promptTokens,
          completionTokens: usage?.completionTokens,
          totalTokens: usage?.totalTokens,
        }, pieceId).catch(() => {});

        // Extract H1 from final content and commit
        const { title, content } = extractH1(accumulated);
        if (title && !titleSetRef.current) {
          updatePiece(pieceId, { title });
        }
        updatePiece(pieceId, { body: content });
        // Final update with H1-stripped content
        setStreamingContent(content);
        // Small delay to ensure last setContent is processed before clearing
        requestAnimationFrame(() => {
          setGeneratingPiece(null);
          setStreamingContent(null);
        });
      }
    } catch (err) {
      if (rafId !== null) cancelAnimationFrame(rafId);

      if ((err as Error).name === "AbortError") {
        // User cancelled — persist partial content
        if (accumulated) {
          const { title, content } = extractH1(accumulated);
          if (title) updatePiece(pieceId, { title });
          updatePiece(pieceId, { body: content });
        }
        setGeneratingPiece(null);
        setStreamingContent(null);
        return;
      }

      const durationMs = Date.now() - startTime;
      logApiCall("generate", "flow-create", ai.provider, ai.model, {
        durationMs,
        statusCode: 0,
        error: "Generation failed",
        promptLength,
        responseLength: 0,
      }, pieceId).catch(() => {});

      // Persist partial content on error
      if (accumulated) {
        const { title, content } = extractH1(accumulated);
        if (title) updatePiece(pieceId, { title });
        updatePiece(pieceId, { body: content });
      }
      setStreamingError("Generation failed. Check your connection.");
      setGeneratingPiece(null);
      setStreamingContent(null);
      useToastStore.getState().showToast("Generation failed. Check your connection.");
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { startGeneration, abort };
}
