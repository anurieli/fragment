import { describe, it, expect } from "vitest";
import {
  resolveVoice,
  composeVoiceContext,
  parseVoiceProfile,
  prepareSamplesForAnalysis,
  CAP_BLOCK,
  CAP_GUIDANCE_ITEMS,
  CAP_GUIDANCE_LEN,
} from "@/lib/voice-context";
import type { BrandVoice, VoiceProfile, VoiceSample } from "@/lib/types";

function makeVoice(overrides: Partial<BrandVoice> = {}): BrandVoice {
  const now = 1000;
  return {
    id: "v1",
    name: "Test Voice",
    description: "A punchy, direct voice.",
    template: "",
    profile: null,
    profileStale: true,
    profileUpdatedAt: null,
    analyzedSampleCount: 0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const fullProfile: VoiceProfile = {
  summary: "Direct, conversational, and concrete.",
  traits: ["short sentences", "active voice"],
  exampleExcerpts: ["This is the way.", "No fluff, ever."],
  doGuidance: ["use concrete nouns"],
  dontGuidance: ["avoid jargon"],
};

describe("resolveVoice", () => {
  const v1 = makeVoice({ id: "v1", createdAt: 1 });
  const v2 = makeVoice({ id: "v2", createdAt: 2 });
  const map = { v1, v2 };

  it("null noteVoiceId → no voice", () => {
    expect(resolveVoice(map, "v1", null)).toBeNull();
  });

  it("undefined noteVoiceId → default voice", () => {
    expect(resolveVoice(map, "v2", undefined)?.id).toBe("v2");
  });

  it("undefined with no default → null", () => {
    expect(resolveVoice(map, null, undefined)).toBeNull();
  });

  it("string id → that voice", () => {
    expect(resolveVoice(map, "v1", "v2")?.id).toBe("v2");
  });

  it("dangling id → falls back to default", () => {
    expect(resolveVoice(map, "v1", "missing")?.id).toBe("v1");
  });

  it("dangling id with dangling default → null", () => {
    expect(resolveVoice(map, "gone", "missing")).toBeNull();
  });

  it("accepts an array of voices", () => {
    expect(resolveVoice([v1, v2], "v2", undefined)?.id).toBe("v2");
  });
});

describe("composeVoiceContext", () => {
  it("returns empty string for null voice", () => {
    expect(composeVoiceContext(null)).toBe("");
  });

  it("pre-analysis fallback emits name + description, no profile sections", () => {
    const block = composeVoiceContext(makeVoice({ profile: null }));
    expect(block).toContain("Test Voice");
    expect(block).toContain("VOICE DESCRIPTION");
    expect(block).not.toContain("VOICE SUMMARY");
  });

  it("with a profile emits summary, traits, examples, do/don't", () => {
    const block = composeVoiceContext(makeVoice({ profile: fullProfile }));
    expect(block).toContain("VOICE SUMMARY");
    expect(block).toContain("KEY TRAITS");
    expect(block).toContain("EXAMPLES");
    expect(block).toContain("This is the way.");
    expect(block).toContain("DO:");
    expect(block).toContain("DON'T:");
  });

  it("includes the structure guide when a template is present", () => {
    const block = composeVoiceContext(makeVoice({ profile: fullProfile, template: "Open with a hook." }));
    expect(block).toContain("STRUCTURE GUIDE");
    expect(block).toContain("Open with a hook.");
  });

  it("hard-caps the whole block", () => {
    const huge: VoiceProfile = {
      summary: "x".repeat(5000),
      traits: Array.from({ length: 20 }, () => "y".repeat(200)),
      exampleExcerpts: Array.from({ length: 20 }, () => "z".repeat(1000)),
      doGuidance: Array.from({ length: 20 }, () => "d".repeat(400)),
      dontGuidance: Array.from({ length: 20 }, () => "n".repeat(400)),
    };
    const block = composeVoiceContext(makeVoice({ profile: huge, template: "t".repeat(5000) }));
    expect(block.length).toBeLessThanOrEqual(CAP_BLOCK);
  });

  it("drops the structure guide before hard-slicing, so profile content survives", () => {
    // A near-max profile that fits under CAP_BLOCK on its own, but overflows once
    // the (capped) template is appended — so the guide must be the part dropped.
    const nearMax: VoiceProfile = {
      summary: "S".repeat(450),
      traits: Array.from({ length: 7 }, () => "t".repeat(90)),
      exampleExcerpts: Array.from({ length: 5 }, () => "e".repeat(320)),
      doGuidance: Array.from({ length: 5 }, () => "d".repeat(120)),
      dontGuidance: Array.from({ length: 5 }, () => "n".repeat(120)),
    };
    const block = composeVoiceContext(makeVoice({ profile: nearMax, template: "G".repeat(1200) }));
    expect(block.length).toBeLessThanOrEqual(CAP_BLOCK);
    expect(block).not.toContain("STRUCTURE GUIDE");
    // The high-signal profile parts all survived intact (not tail-truncated).
    expect(block).toContain("VOICE SUMMARY");
    expect(block).toContain("DON'T:");
    expect(block).toContain("n".repeat(120));
  });

  it("caps do/don't guidance to CAP_GUIDANCE_ITEMS items", () => {
    const profile: VoiceProfile = {
      summary: "s",
      traits: [],
      exampleExcerpts: [],
      doGuidance: Array.from({ length: 10 }, (_, i) => `do item ${i}`),
      dontGuidance: [],
    };
    const block = composeVoiceContext(makeVoice({ profile }));
    const doLines = block.split("\n").filter((l) => l.startsWith("- do item"));
    expect(doLines.length).toBe(CAP_GUIDANCE_ITEMS);
  });
});

describe("parseVoiceProfile", () => {
  it("parses a plain JSON object", () => {
    const raw = JSON.stringify(fullProfile);
    const parsed = parseVoiceProfile(raw);
    expect(parsed?.summary).toBe(fullProfile.summary);
    expect(parsed?.traits).toEqual(fullProfile.traits);
  });

  it("strips ```json fences", () => {
    const raw = "```json\n" + JSON.stringify(fullProfile) + "\n```";
    expect(parseVoiceProfile(raw)?.summary).toBe(fullProfile.summary);
  });

  it("extracts JSON embedded in prose", () => {
    const raw = "Here is the profile:\n" + JSON.stringify(fullProfile) + "\nThanks!";
    expect(parseVoiceProfile(raw)?.summary).toBe(fullProfile.summary);
  });

  it("returns null for junk", () => {
    expect(parseVoiceProfile("not json at all")).toBeNull();
    expect(parseVoiceProfile("")).toBeNull();
    expect(parseVoiceProfile("{ broken")).toBeNull();
  });

  it("returns null when nothing usable is present", () => {
    expect(parseVoiceProfile(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  it("accepts a profile with traits but no summary", () => {
    const parsed = parseVoiceProfile(
      JSON.stringify({ traits: ["punchy"], exampleExcerpts: [], doGuidance: [], dontGuidance: [] }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.summary).toBe("");
    expect(parsed!.traits).toEqual(["punchy"]);
  });

  it("caps do/don't guidance count and length", () => {
    const parsed = parseVoiceProfile(
      JSON.stringify({
        summary: "ok",
        traits: [],
        exampleExcerpts: [],
        doGuidance: Array.from({ length: 10 }, (_, i) => `d${i} ` + "x".repeat(300)),
        dontGuidance: Array.from({ length: 10 }, () => "y"),
      }),
    );
    expect(parsed!.doGuidance.length).toBeLessThanOrEqual(CAP_GUIDANCE_ITEMS);
    expect(parsed!.doGuidance.every((d) => d.length <= CAP_GUIDANCE_LEN)).toBe(true);
    expect(parsed!.dontGuidance.length).toBeLessThanOrEqual(CAP_GUIDANCE_ITEMS);
  });

  it("applies caps to oversized fields", () => {
    const parsed = parseVoiceProfile(
      JSON.stringify({
        summary: "s".repeat(2000),
        traits: Array.from({ length: 30 }, (_, i) => `trait ${i}`),
        exampleExcerpts: ["ok"],
        doGuidance: [],
        dontGuidance: [],
      }),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.summary.length).toBeLessThanOrEqual(450);
    expect(parsed!.traits.length).toBeLessThanOrEqual(7);
  });

  it("drops non-string list entries", () => {
    const parsed = parseVoiceProfile(
      JSON.stringify({ summary: "ok", traits: ["a", 5, null, "b"], exampleExcerpts: [], doGuidance: [], dontGuidance: [] }),
    );
    expect(parsed!.traits).toEqual(["a", "b"]);
  });
});

describe("prepareSamplesForAnalysis", () => {
  function sample(id: string, text: string, createdAt: number): VoiceSample {
    return { id, voiceId: "v1", title: `S-${id}`, source: "paste", text, charCount: text.length, createdAt };
  }

  it("returns empty for no samples", () => {
    expect(prepareSamplesForAnalysis([])).toBe("");
  });

  it("wraps each sample with a header", () => {
    const out = prepareSamplesForAnalysis([sample("a", "hello", 1)]);
    expect(out).toContain("=== SAMPLE 1: S-a ===");
    expect(out).toContain("hello");
  });

  it("orders newest-first and caps at 12 samples", () => {
    const many = Array.from({ length: 20 }, (_, i) => sample(`s${i}`, `text ${i}`, i));
    const out = prepareSamplesForAnalysis(many);
    // newest (s19) should appear; there should be exactly 12 sample headers
    const headers = out.match(/=== SAMPLE/g) ?? [];
    expect(headers.length).toBe(12);
    expect(out).toContain("text 19");
  });

  it("head-tail truncates oversized samples with a marker", () => {
    const big = sample("big", "A".repeat(50000), 1);
    const out = prepareSamplesForAnalysis([big]);
    expect(out).toContain("[...]");
  });
});
