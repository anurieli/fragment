/**
 * Voice context composer — pure module (NO React), shared by the web hooks and
 * the Tauri client mirror, exactly like `provider-runtime.ts`.
 *
 * Turns a resolved BrandVoice into the compact system-message block that rides
 * along per generation, and parses the raw analysis response back into a
 * VoiceProfile. Everything here is defensive: hard caps keep the injected block
 * bounded regardless of what the model or the user produced.
 */

import type { BrandVoice, VoiceProfile, VoiceSample } from "./types";

// Defensive caps (chars). Mirror the limits stated in the analysis prompt, but
// enforced here so a misbehaving model can never blow up a generation request.
export const CAP_SUMMARY = 450;
export const CAP_TRAITS = 7;
export const CAP_TRAIT_LEN = 90;
export const CAP_EXCERPTS = 5;
export const CAP_EXCERPT_LEN = 320;
export const CAP_TEMPLATE = 1200;
export const CAP_GUIDANCE_ITEMS = 5;
export const CAP_GUIDANCE_LEN = 120;
/** Whole composed block ceiling (~1,200 tokens). */
export const CAP_BLOCK = 4800;

// Analysis sample-budgeting.
const MAX_SAMPLES = 12;
const SAMPLE_BUDGET = 24000;
const MIN_PER_SAMPLE = 2000;

function clampStr(value: unknown, maxLen: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= maxLen ? trimmed : trimmed.slice(0, maxLen).trimEnd();
}

function clampList(value: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const s = clampStr(item, maxLen);
    if (s) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Voice resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which voice a note should use.
 *   - noteVoiceId === null      → no voice (explicit)
 *   - noteVoiceId === undefined → the default voice (inherit)
 *   - noteVoiceId === string    → that voice; if it no longer exists, fall back
 *                                 to the default, then to none.
 */
export function resolveVoice(
  voices: Record<string, BrandVoice> | BrandVoice[],
  defaultVoiceId: string | null,
  noteVoiceId: string | null | undefined,
): BrandVoice | null {
  const map: Record<string, BrandVoice> = Array.isArray(voices)
    ? Object.fromEntries(voices.map((v) => [v.id, v]))
    : voices;

  const byDefault = (): BrandVoice | null =>
    (defaultVoiceId && map[defaultVoiceId]) || null;

  if (noteVoiceId === null) return null;
  if (noteVoiceId === undefined) return byDefault();
  return map[noteVoiceId] ?? byDefault();
}

// ---------------------------------------------------------------------------
// System-block composition
// ---------------------------------------------------------------------------

/**
 * Build the voice system block. Returns "" when there is nothing to inject
 * (so callers can keep request bodies byte-identical to the no-voice path).
 *
 * Pre-analysis fallback: when `profile` is null, emit the name + description
 * (+ template) only, so a freshly-created voice already influences generation.
 */
export function composeVoiceContext(voice: BrandVoice | null): string {
  if (!voice) return "";

  const lines: string[] = [];
  lines.push(`You are writing in the user's saved voice: "${clampStr(voice.name, 120)}".`);
  lines.push("Adopt this voice for everything you generate below.");

  const profile = voice.profile;
  if (profile) {
    const summary = clampStr(profile.summary, CAP_SUMMARY);
    if (summary) lines.push(`\nVOICE SUMMARY:\n${summary}`);

    const traits = clampList(profile.traits, CAP_TRAITS, CAP_TRAIT_LEN);
    if (traits.length) {
      lines.push(`\nKEY TRAITS:\n${traits.map((t) => `- ${t}`).join("\n")}`);
    }

    const excerpts = clampList(profile.exampleExcerpts, CAP_EXCERPTS, CAP_EXCERPT_LEN);
    if (excerpts.length) {
      lines.push(
        `\nEXAMPLES (match their rhythm, diction, and structure; never copy their content):\n${excerpts
          .map((e, i) => `${i + 1}. ${e}`)
          .join("\n")}`,
      );
    }

    const dos = clampList(profile.doGuidance, CAP_GUIDANCE_ITEMS, CAP_GUIDANCE_LEN);
    if (dos.length) lines.push(`\nDO:\n${dos.map((d) => `- ${d}`).join("\n")}`);

    const donts = clampList(profile.dontGuidance, CAP_GUIDANCE_ITEMS, CAP_GUIDANCE_LEN);
    if (donts.length) lines.push(`\nDON'T:\n${donts.map((d) => `- ${d}`).join("\n")}`);
  } else {
    const description = clampStr(voice.description, CAP_SUMMARY);
    if (description) lines.push(`\nVOICE DESCRIPTION:\n${description}`);
  }

  const template = clampStr(voice.template, CAP_TEMPLATE);
  if (template) lines.push(`\nSTRUCTURE GUIDE:\n${template}`);

  let block = lines.join("\n");

  // Whole-block ceiling: drop the structure guide first, then trim excerpts by
  // hard-truncating the tail, so the highest-signal parts survive.
  if (block.length > CAP_BLOCK && template) {
    block = lines.filter((l) => !l.startsWith("\nSTRUCTURE GUIDE:")).join("\n");
  }
  if (block.length > CAP_BLOCK) {
    block = block.slice(0, CAP_BLOCK).trimEnd();
  }
  return block;
}

// ---------------------------------------------------------------------------
// Analysis response parsing
// ---------------------------------------------------------------------------

/**
 * Parse the raw analysis completion into a VoiceProfile. Strips code fences,
 * JSON-parses defensively, type-guards every field, and applies caps. Returns
 * null on any failure so callers keep the previous profile.
 */
export function parseVoiceProfile(raw: string): VoiceProfile | null {
  if (typeof raw !== "string" || !raw.trim()) return null;

  let text = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();

  // If there's leading/trailing prose, grab the outermost JSON object.
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    text = text.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  const summary = clampStr(obj.summary, CAP_SUMMARY);
  const traits = clampList(obj.traits, CAP_TRAITS, CAP_TRAIT_LEN);
  const exampleExcerpts = clampList(obj.exampleExcerpts, CAP_EXCERPTS, CAP_EXCERPT_LEN);
  const doGuidance = clampList(obj.doGuidance, CAP_GUIDANCE_ITEMS, CAP_GUIDANCE_LEN);
  const dontGuidance = clampList(obj.dontGuidance, CAP_GUIDANCE_ITEMS, CAP_GUIDANCE_LEN);

  // Require at least a summary — otherwise the analysis produced nothing usable.
  if (!summary && traits.length === 0 && exampleExcerpts.length === 0) return null;

  return { summary, traits, exampleExcerpts, doGuidance, dontGuidance };
}

// ---------------------------------------------------------------------------
// Sample budgeting for the analysis call
// ---------------------------------------------------------------------------

/** Head 60% + tail 40% with a marker, when a sample exceeds its allowance. */
function sampleHeadTail(text: string, allowance: number): string {
  if (text.length <= allowance) return text;
  const headLen = Math.floor(allowance * 0.6);
  const tailLen = allowance - headLen;
  return `${text.slice(0, headLen)}\n[...]\n${text.slice(text.length - tailLen)}`;
}

/**
 * Assemble the `{samples}` block for the analysis prompt: newest-first, capped
 * at MAX_SAMPLES, within a total char budget, each wrapped with a header.
 */
export function prepareSamplesForAnalysis(samples: VoiceSample[]): string {
  const ordered = [...samples].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_SAMPLES);
  if (ordered.length === 0) return "";

  const perSample = Math.max(MIN_PER_SAMPLE, Math.floor(SAMPLE_BUDGET / ordered.length));

  const blocks: string[] = [];
  let used = 0;
  ordered.forEach((sample, i) => {
    if (used >= SAMPLE_BUDGET) return;
    const title = clampStr(sample.title, 80) || `Sample ${i + 1}`;
    const body = sampleHeadTail((sample.text ?? "").trim(), perSample);
    const block = `=== SAMPLE ${i + 1}: ${title} ===\n${body}`;
    blocks.push(block);
    used += block.length;
  });

  return blocks.join("\n\n");
}
