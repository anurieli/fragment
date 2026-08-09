"use client";

import { useMemo } from "react";
import { useContentStore } from "@/stores/content-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useVoiceStore } from "@/stores/voice-store";
import { resolveVoice } from "@/lib/voice-context";
import { resolveBriefWithSources, type Brief, type ResolvedBrief } from "@/lib/brief-context";
import type { BrandVoice } from "@/lib/types";
import type { ContentPiece, Idea } from "@/lib/content-engine/contract";

/**
 * The voice a fragment writes in: its own, else its idea's, else the default.
 * `null` on the fragment still means "explicitly no voice" and stops the walk,
 * which is why this uses `??` rather than `||`.
 */
export function voiceIdFor(
  piece?: Pick<ContentPiece, "voiceId"> | null,
  idea?: Pick<Idea, "voiceId"> | null,
): string | null | undefined {
  return piece?.voiceId ?? idea?.voiceId;
}

export interface BriefContext {
  brief: ResolvedBrief;
  /** The voice in play, already resolved — pass to composeVoiceContext. */
  voice: BrandVoice | null;
  idea: Idea | null;
}

/**
 * Non-reactive resolution, for the imperative hooks that already read their
 * stores through getState() rather than subscribing. Same walk, same answer.
 */
export function briefForPiece(piece: ContentPiece): { brief: Brief; voice: BrandVoice | null } {
  const idea = useContentStore.getState().ideas[piece.ideaId] ?? null;
  const voices = useVoiceStore.getState().voices;
  const defaultVoiceId = useSettingsStore.getState().settings.brandVoice.defaultVoiceId;
  const voice = resolveVoice(voices, defaultVoiceId, voiceIdFor(piece, idea));
  const r = resolveBriefWithSources({ piece, idea, voice });
  return {
    brief: {
      goal: r.goal.value,
      audience: r.audience.value,
      tone: r.tone.value,
      remember: r.remember.value,
    },
    voice,
  };
}

/**
 * Resolve a fragment's writing brief and voice together, walking
 * fragment → idea → voice. Every AI call site should read its goal, audience,
 * tone and remember from here rather than off the piece, or a value the writer
 * set on their voice or their idea will silently not reach the model.
 *
 * Values are read at call time, never copied onto the fragment, which is what
 * keeps an untouched field following the voice when the voice changes.
 */
export function useBrief(piece?: ContentPiece | null): BriefContext {
  const ideas = useContentStore((s) => s.ideas);
  const voicesMap = useVoiceStore((s) => s.voices);
  const defaultVoiceId = useSettingsStore((s) => s.settings.brandVoice.defaultVoiceId);

  const idea = piece ? ideas[piece.ideaId] ?? null : null;

  return useMemo(() => {
    const voice = resolveVoice(voicesMap, defaultVoiceId, voiceIdFor(piece, idea));
    return { brief: resolveBriefWithSources({ piece, idea, voice }), voice, idea };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece, idea, voicesMap, defaultVoiceId]);
}

/**
 * Just the four strings, for call sites that send the brief to the model and
 * have no use for which tier each value came from.
 */
export function useResolvedBrief(piece?: ContentPiece | null): Brief {
  const { brief } = useBrief(piece);
  return useMemo(
    () => ({
      goal: brief.goal.value,
      audience: brief.audience.value,
      tone: brief.tone.value,
      remember: brief.remember.value,
    }),
    [brief],
  );
}
