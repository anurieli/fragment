"use client";

import { useCallback, useRef } from "react";
import { useAppStore } from "@/stores/app-store";
import { useContentStore } from "@/stores/content-store";
import { useDataStore } from "@/stores/data-store";
import { useSettingsStore, waitForSettingsHydration } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { resolveVoice, composeVoiceContext } from "@/lib/voice-context";
import { useToastStore } from "@/hooks/use-toast";
import { postGenerateStream } from "@/lib/ai-client";
import { getProviderKey } from "@/lib/ai/provider-runtime";
import { hasWorkingProvider } from "@/lib/ai/connection-status";
import { ensureValidCodexToken, forceRefreshCodexToken } from "@/lib/codex-token-manager";
import { parseSSEStreamWithUsage } from "@/lib/sse-parser";
import { logApiCall } from "@/lib/api-logger";
import { DEFAULT_NOTE_CREATION_PROMPT } from "@/lib/defaults";

/** Extract a leading H1 from markdown, returning the title and remaining content. */
function extractH1(markdown: string): { title: string; content: string } {
  const match = markdown.match(/^#\s+(.+)\n?/);
  if (!match) return { title: "", content: markdown };
  return { title: match[1].trim(), content: markdown.slice(match[0].length).trimStart() };
}


function getAIConfig() {
  const s = useSettingsStore.getState().settings;
  const provider = s.featureProviders.slashCommand.provider;
  return {
    provider,
    model: s.featureProviders.slashCommand.model,
    apiKey: getProviderKey(provider, s.providerCredentials) || undefined,
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
  /** If provided, stream into this existing note instead of creating a new one. */
  existingNoteId?: string;
  /** Voice to apply. undefined = inherit default, null = no voice, string = specific voice. */
  voiceId?: string | null;
}

export function useStreamGeneration() {
  const abortRef = useRef<AbortController | null>(null);
  const titleSetRef = useRef(false);

  const startGeneration = useCallback(async (params: StreamGenerationParams) => {
    const { prompt, goal, audience, tone, remember, existingNoteId, voiceId } = params;

    const {
      createNote,
      updateNoteContent,
      updateNoteTitle,
      updateNoteGoal,
      updateNoteAudience,
      updateNoteTone,
      updateNoteRemember,
      updateNoteVoice,
    } = useDataStore.getState();

    const {
      setActiveNote,
      setGeneratingNote,
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

    // 1. Create the note (or use existing) and navigate immediately
    let noteId: string;
    if (existingNoteId) {
      noteId = existingNoteId;
    } else {
      noteId = createNote();
      // Generated inside an open idea → it's a draft of that idea, not a
      // standalone note (same rule as NoteCreationFlow's finishCreate).
      const ideaId = useAppStore.getState().activeIdeaId;
      if (ideaId) useContentStore.getState().linkNoteToIdea(ideaId, noteId);
    }

    // Set metadata
    if (goal) updateNoteGoal(noteId, goal);
    if (audience) updateNoteAudience(noteId, audience);
    if (tone) updateNoteTone(noteId, tone);
    if (remember) updateNoteRemember(noteId, remember);
    if (voiceId !== undefined) updateNoteVoice(noteId, voiceId);

    // Dismiss context tooltip so it doesn't obscure streaming text
    dismissContextPrompt(noteId);

    // Set streaming state BEFORE navigating so the editor knows it's generating
    setGeneratingNote(noteId);
    setStreamingContent("");
    setStreamingError(null);

    // Navigate to the note (closes creation flow)
    if (!existingNoteId) {
      setActiveNote(noteId);
    }

    // 2. Build request and start streaming
    await waitForSettingsHydration();
    const ai = getAIConfig();
    const app = useAppStore.getState();
    if (!hasWorkingProvider(useSettingsStore.getState().settings, app.badProviders, "slashCommand")) {
      app.openAiGate("no-provider");
      setStreamingError("No AI provider connected");
      setGeneratingNote(null);
      setStreamingContent(null);
      return;
    }
    const promptLength = prompt.length + (goal?.length ?? 0) + (audience?.length ?? 0) + (tone?.length ?? 0) + (remember?.length ?? 0);

    const { voices } = useVoiceStore.getState();
    const defaultVoiceId = useSettingsStore.getState().settings.brandVoice.defaultVoiceId;
    const voiceContext = composeVoiceContext(resolveVoice(voices, defaultVoiceId, voiceId));

    const buildBody = (token: string | undefined) =>
      JSON.stringify({
        contextAbove: "",
        contextBelow: "",
        goal,
        audience,
        tone,
        remember,
        userInstruction: prompt,
        promptTemplate: DEFAULT_NOTE_CREATION_PROMPT,
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
          setGeneratingNote(null);
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
        setGeneratingNote(null);
        setStreamingContent(null);
        const isAuthFailure = res.status === 401;
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
        }, noteId).catch(() => {});
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
            updateNoteTitle(noteId, titleMatch[1].trim());
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
        }, noteId).catch(() => {});

        // Extract H1 from final content and commit
        const { title, content } = extractH1(accumulated);
        if (title && !titleSetRef.current) {
          updateNoteTitle(noteId, title);
        }
        updateNoteContent(noteId, content);
        // Final update with H1-stripped content
        setStreamingContent(content);
        // Small delay to ensure last setContent is processed before clearing
        requestAnimationFrame(() => {
          setGeneratingNote(null);
          setStreamingContent(null);
        });
      }
    } catch (err) {
      if (rafId !== null) cancelAnimationFrame(rafId);

      if ((err as Error).name === "AbortError") {
        // User cancelled — persist partial content
        if (accumulated) {
          const { title, content } = extractH1(accumulated);
          if (title) updateNoteTitle(noteId, title);
          updateNoteContent(noteId, content);
        }
        setGeneratingNote(null);
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
      }, noteId).catch(() => {});

      // Persist partial content on error
      if (accumulated) {
        const { title, content } = extractH1(accumulated);
        if (title) updateNoteTitle(noteId, title);
        updateNoteContent(noteId, content);
      }
      setStreamingError("Generation failed. Check your connection.");
      setGeneratingNote(null);
      setStreamingContent(null);
      useToastStore.getState().showToast("Generation failed. Check your connection.");
    }
  }, []);

  const abort = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { startGeneration, abort };
}
