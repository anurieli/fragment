import { describe, it, expect } from "vitest";

import {
  buildIdeaBrief,
  MAX_RESOURCES,
  MAX_SIBLINGS,
  SIBLING_EXCERPT_CHARS,
  type BriefPiece,
} from "@/lib/ai-context";
import type { EffectiveResource } from "@/stores/resources-selectors";

function piece(over: Partial<BriefPiece> = {}): BriefPiece {
  return { id: "p1", title: undefined, body: "Some words.", updatedAt: 1000, ...over };
}

function resource(over: Partial<EffectiveResource["resource"]> = {}): EffectiveResource {
  return {
    resource: {
      id: "r1",
      ownerType: "idea",
      ownerId: "i1",
      kind: "link",
      title: "The report",
      url: "https://example.com/report",
      createdAt: 1,
      ...over,
    },
  };
}

const EMPTY = { idea: null, siblings: [], resources: [] };

describe("buildIdeaBrief", () => {
  it("names the idea and its summary", () => {
    const brief = buildIdeaBrief({
      ...EMPTY,
      idea: { title: "Agents are not cheaper juniors", summary: "The cost argument is wrong." },
    });

    expect(brief).toContain("IDEA: Agents are not cheaper juniors");
    expect(brief).toContain("The cost argument is wrong.");
  });

  it("says so rather than going quiet when there is nothing around", () => {
    // The generate route substitutes "(beginning of document)" for an empty
    // contextAbove, which would be a lie inside a creation prompt.
    const brief = buildIdeaBrief(EMPTY);

    expect(brief).not.toBe("");
    expect(brief).toContain("first thing in a new idea");
  });

  it("lists what the idea already holds, newest first", () => {
    const brief = buildIdeaBrief({
      ...EMPTY,
      siblings: [
        piece({ id: "old", title: "Older take", body: "written first", updatedAt: 1 }),
        piece({ id: "new", title: "Newer take", body: "written second", updatedAt: 99 }),
      ],
    });

    expect(brief.indexOf("Newer take")).toBeLessThan(brief.indexOf("Older take"));
    expect(brief).toContain("do not repeat them");
  });

  it("labels an untitled sibling by its opening words", () => {
    const brief = buildIdeaBrief({
      ...EMPTY,
      siblings: [piece({ body: "A junior returns judgment, an agent returns output." })],
    });

    expect(brief).toContain("A junior returns judgment");
  });

  it("leaves empty siblings out entirely", () => {
    const brief = buildIdeaBrief({
      ...EMPTY,
      siblings: [piece({ id: "blank", title: "Blank", body: "   \n  " })],
    });

    expect(brief).not.toContain("Blank");
  });

  it("strips markdown so a heading reads as words, not hashes", () => {
    const brief = buildIdeaBrief({
      ...EMPTY,
      siblings: [piece({ body: "## The cost argument\n\nIt does not hold." })],
    });

    expect(brief).toContain("The cost argument");
    expect(brief).not.toContain("##");
  });

  it("truncates a long sibling instead of pasting the whole thing", () => {
    const brief = buildIdeaBrief({
      ...EMPTY,
      siblings: [piece({ title: "Long one", body: "word ".repeat(400) })],
    });

    expect(brief).toContain("...");
    expect(brief.length).toBeLessThan(SIBLING_EXCERPT_CHARS * 3);
  });

  it("announces what it cut rather than dropping it silently", () => {
    const many = Array.from({ length: MAX_SIBLINGS + 3 }, (_, i) =>
      piece({ id: `p${i}`, title: `Piece ${i}`, body: "text", updatedAt: i }),
    );

    const brief = buildIdeaBrief({ ...EMPTY, siblings: many });

    expect(brief).toContain("(3 more not shown)");
  });

  it("carries the sources with their urls and notes", () => {
    const brief = buildIdeaBrief({
      ...EMPTY,
      resources: [resource({ title: "The report", note: "the claim I am arguing with" })],
    });

    expect(brief).toContain("SOURCES THE WRITER ATTACHED");
    expect(brief).toContain("The report");
    expect(brief).toContain("https://example.com/report");
    expect(brief).toContain("the claim I am arguing with");
  });

  it("caps the sources too, and says how many it held back", () => {
    const many = Array.from({ length: MAX_RESOURCES + 2 }, (_, i) =>
      resource({ id: `r${i}`, title: `Source ${i}` }),
    );

    const brief = buildIdeaBrief({ ...EMPTY, resources: many });

    expect(brief).toContain("(2 more not shown)");
  });

  it("composes all three sections when everything is present", () => {
    const brief = buildIdeaBrief({
      idea: { title: "An idea", summary: undefined },
      siblings: [piece({ title: "A piece", body: "text" })],
      resources: [resource()],
    });

    expect(brief).toContain("IDEA: An idea");
    expect(brief).toContain("A piece");
    expect(brief).toContain("The report");
    expect(brief).not.toContain("first thing in a new idea");
  });
});
