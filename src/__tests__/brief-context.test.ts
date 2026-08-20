import { describe, it, expect } from "vitest";
import { resolveBrief, resolveBriefWithSources, inheritedBrief } from "@/lib/brief-context";
import type { BrandVoice } from "@/lib/types";
import type { ContentPiece, Idea } from "@/lib/content-engine/contract";

function voice(overrides: Partial<BrandVoice> = {}): BrandVoice {
  return {
    id: "v1",
    name: "Indy Leader",
    description: "",
    template: "",
    profile: null,
    profileStale: false,
    profileUpdatedAt: null,
    analyzedSampleCount: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function idea(overrides: Partial<Idea> = {}): Idea {
  return {
    id: "i1",
    title: "An idea",
    parentId: null,
    priority: "none",
    origin: "user",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Idea;
}

function piece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "p1",
    ideaId: "i1",
    format: "essay",
    status: "in-progress",
    origin: "user",
    body: "",
    seen: true,
    priority: "none",
    order: 0,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as ContentPiece;
}

describe("resolveBrief — the inheritance chain", () => {
  it("takes audience and tone from the voice when nothing below sets them", () => {
    const b = resolveBrief({
      piece: piece(),
      idea: idea(),
      voice: voice({ defaultAudience: "Solo founders", defaultTone: "Direct" }),
    });
    expect(b.audience).toBe("Solo founders");
    expect(b.tone).toBe("Direct");
  });

  it("lets the idea override the voice", () => {
    const b = resolveBrief({
      piece: piece(),
      idea: idea({ audience: "Investors" }),
      voice: voice({ defaultAudience: "Solo founders" }),
    });
    expect(b.audience).toBe("Investors");
  });

  it("lets the fragment override both", () => {
    const b = resolveBrief({
      piece: piece({ audience: "My team" }),
      idea: idea({ audience: "Investors" }),
      voice: voice({ defaultAudience: "Solo founders" }),
    });
    expect(b.audience).toBe("My team");
  });

  /**
   * The whole point of resolving at call time rather than copying values down:
   * a fragment that never set an audience follows the voice, so editing the
   * voice moves it. A fragment that did set one is unaffected.
   */
  it("moves an untouched fragment when the voice changes, and leaves an edited one alone", () => {
    const before = voice({ defaultTone: "Direct" });
    const after = voice({ defaultTone: "Playful" });

    const untouched = piece();
    expect(resolveBrief({ piece: untouched, idea: idea(), voice: before }).tone).toBe("Direct");
    expect(resolveBrief({ piece: untouched, idea: idea(), voice: after }).tone).toBe("Playful");

    const edited = piece({ tone: "Deadpan" });
    expect(resolveBrief({ piece: edited, idea: idea(), voice: after }).tone).toBe("Deadpan");
  });

  it("has no voice tier for goal — it is the piece's own business", () => {
    const b = resolveBrief({
      piece: piece(),
      idea: idea({ goal: "Change how founders hire" }),
      // A voice cannot carry a goal at all; this asserts the chain stops.
      voice: voice({ defaultAudience: "Solo founders" }),
    });
    expect(b.goal).toBe("Change how founders hire");

    const noIdeaGoal = resolveBrief({ piece: piece(), idea: idea(), voice: voice() });
    expect(noIdeaGoal.goal).toBe("");
  });
});

describe("resolveBrief — what counts as 'set'", () => {
  it("treats empty string and whitespace as inherit, which is how you reset a field", () => {
    const v = voice({ defaultAudience: "Solo founders" });
    expect(resolveBrief({ piece: piece({ audience: "" }), idea: idea(), voice: v }).audience)
      .toBe("Solo founders");
    expect(resolveBrief({ piece: piece({ audience: "   " }), idea: idea(), voice: v }).audience)
      .toBe("Solo founders");
    expect(resolveBrief({ piece: piece({ audience: undefined }), idea: idea(), voice: v }).audience)
      .toBe("Solo founders");
  });

  it("trims what it returns, so a stray space never reaches the prompt", () => {
    const b = resolveBrief({ piece: piece({ tone: "  Direct  " }), idea: idea(), voice: voice() });
    expect(b.tone).toBe("Direct");
  });

  it("resolves to empty when no tier says anything", () => {
    const b = resolveBrief({ piece: piece(), idea: idea(), voice: null });
    expect(b).toEqual({ goal: "", audience: "", tone: "", remember: "" });
  });

  it("survives a missing idea and a missing voice", () => {
    expect(resolveBrief({ piece: piece({ tone: "Wry" }) }).tone).toBe("Wry");
    expect(resolveBrief({}).audience).toBe("");
  });
});

describe("resolveBriefWithSources", () => {
  it("names the tier each value came from, for the 'from …' hint", () => {
    const r = resolveBriefWithSources({
      piece: piece({ goal: "Sell the workshop" }),
      idea: idea({ audience: "Investors" }),
      voice: voice({ defaultTone: "Direct" }),
    });
    expect(r.goal).toEqual({ value: "Sell the workshop", source: "fragment" });
    expect(r.audience).toEqual({ value: "Investors", source: "idea" });
    expect(r.tone).toEqual({ value: "Direct", source: "voice" });
    expect(r.remember).toEqual({ value: "", source: "none" });
  });
});

describe("inheritedBrief", () => {
  /**
   * An input must never offer its own current text back as its placeholder,
   * or clearing the field would look like it changed nothing.
   */
  it("skips the level being edited", () => {
    const inputs = {
      piece: piece({ audience: "My team" }),
      idea: idea({ audience: "Investors" }),
      voice: voice({ defaultAudience: "Solo founders" }),
    };
    expect(inheritedBrief("fragment", inputs).audience.value).toBe("Investors");
    expect(inheritedBrief("idea", inputs).audience.value).toBe("Solo founders");
  });

  it("shows an idea's goal nothing to inherit, since no tier sits above it", () => {
    const inputs = { idea: idea({ goal: "Change how founders hire" }), voice: voice() };
    expect(inheritedBrief("idea", inputs).goal.value).toBe("");
  });
});
