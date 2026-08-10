/**
 * Brief resolution — pure module (NO React), the companion to voice-context.ts.
 *
 * A writing brief is four fields: goal, audience, tone, remember. They can be
 * set in three places, and the nearest one that has something to say wins:
 *
 *   audience / tone / remember   voice → idea → fragment
 *   goal                                 idea → fragment
 *
 * Goal has no voice tier on purpose. A voice is a persona: it implies who you
 * are talking to and how you sound, but not what any particular piece is
 * trying to achieve. That is the piece's business.
 *
 * Nothing is ever copied down. A fragment that has not set its own audience
 * has no audience stored, it reads the one above it at the moment of the call,
 * so editing the voice moves every piece that never overrode it. Editing the
 * field on a piece detaches that piece, and only that piece.
 *
 * Empty string and undefined both mean "inherit". The editor writes "" the
 * moment you clear a field, so the two are indistinguishable in stored data
 * anyway, and clearing a field is exactly how a writer says "go back to my
 * usual". There is no third state here — unlike voiceId, where `null` has to
 * mean "explicitly no voice", because writing with no voice at all is a real
 * choice in a way that writing for no audience at all is not.
 */

import type { BrandVoice } from "./types";
import type { ContentPiece, Idea } from "./content-engine/contract";

export interface Brief {
  goal: string;
  audience: string;
  tone: string;
  remember: string;
}

/** Where a resolved value came from. Drives the "from <x>" hint in the UI. */
export type BriefSource = "fragment" | "idea" | "voice" | "none";

export interface ResolvedBriefField {
  value: string;
  source: BriefSource;
}

export interface ResolvedBrief {
  goal: ResolvedBriefField;
  audience: ResolvedBriefField;
  tone: ResolvedBriefField;
  remember: ResolvedBriefField;
}

/** Trim, and treat whitespace-only as absent. */
function present(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** First tier with something to say, in the order given. */
function firstOf(
  candidates: Array<[BriefSource, string | null | undefined]>,
): ResolvedBriefField {
  for (const [source, raw] of candidates) {
    const value = present(raw);
    if (value) return { value, source };
  }
  return { value: "", source: "none" };
}

export interface BriefInputs {
  /** The fragment being written. Its own values beat everything. */
  piece?: Pick<ContentPiece, "goal" | "audience" | "tone" | "remember"> | null;
  /** The idea the fragment sits in. */
  idea?: Pick<Idea, "goal" | "audience" | "tone" | "remember"> | null;
  /**
   * The voice already resolved for this fragment — pass the return value of
   * resolveVoice, so the brief and the voice system block can never disagree
   * about which voice is in play.
   */
  voice?: BrandVoice | null;
}

/**
 * Resolve the brief, keeping track of which tier each value came from.
 * Use this where the UI needs to say "inherited from your voice"; use
 * `resolveBrief` where you only need the strings to send to the model.
 */
export function resolveBriefWithSources({ piece, idea, voice }: BriefInputs): ResolvedBrief {
  return {
    goal: firstOf([
      ["fragment", piece?.goal],
      ["idea", idea?.goal],
    ]),
    audience: firstOf([
      ["fragment", piece?.audience],
      ["idea", idea?.audience],
      ["voice", voice?.defaultAudience],
    ]),
    tone: firstOf([
      ["fragment", piece?.tone],
      ["idea", idea?.tone],
      ["voice", voice?.defaultTone],
    ]),
    remember: firstOf([
      ["fragment", piece?.remember],
      ["idea", idea?.remember],
      ["voice", voice?.defaultRemember],
    ]),
  };
}

/** The four strings the prompt templates want. Empty means "nothing set". */
export function resolveBrief(inputs: BriefInputs): Brief {
  const r = resolveBriefWithSources(inputs);
  return {
    goal: r.goal.value,
    audience: r.audience.value,
    tone: r.tone.value,
    remember: r.remember.value,
  };
}

/**
 * The value a field would take if this level stopped overriding it — what the
 * editor shows greyed in an empty input. Same resolution, minus the tier being
 * edited, so an input never offers its own current text back as a placeholder.
 */
export function inheritedBrief(
  level: "fragment" | "idea",
  inputs: BriefInputs,
): ResolvedBrief {
  return resolveBriefWithSources(
    level === "fragment" ? { ...inputs, piece: null } : { ...inputs, piece: null, idea: null },
  );
}
