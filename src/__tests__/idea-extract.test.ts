import { describe, expect, it } from "vitest";
import {
  MAX_EXTRACTED,
  MAX_SOURCE_CHARS,
  buildExtractSource,
  hasEnoughToExtract,
  parseExtracted,
} from "@/lib/agents/extract";
import type { ContentPiece, Idea, Resource } from "@/lib/content-engine";

const NOW = 1_760_000_000_000;

function idea(over: Partial<Idea> = {}): Idea {
  return {
    id: "i1",
    title: "The long way home",
    parentId: null,
    priority: "none",
    origin: "user",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as Idea;
}

function piece(over: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "p1",
    ideaId: "i1",
    title: "",
    body: "words",
    format: "essay",
    status: "in-progress",
    order: 0,
    origin: "user",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  } as ContentPiece;
}

function resource(over: Partial<Resource> = {}): Resource {
  return {
    id: "r1",
    ownerType: "idea",
    ownerId: "i1",
    kind: "link",
    title: "A source",
    createdAt: NOW,
    ...over,
  } as Resource;
}

describe("extractor — what the agent reads", () => {
  it("carries the brief, the drafts and the pieces, each labelled", () => {
    const source = buildExtractSource(
      idea({ goal: "make the case", audience: "founders", tone: "plain" }),
      [
        piece({ id: "d1", title: "Draft one", body: "the long-form argument" }),
        piece({ id: "s1", format: "linkedin", body: "a short post" }),
      ],
      [],
    );

    expect(source.text).toContain("The long way home");
    expect(source.text).toContain("Goal: make the case");
    expect(source.text).toContain("Audience: founders");
    expect(source.text).toContain("Draft: Draft one");
    expect(source.text).toContain("the long-form argument");
    expect(source.text).toContain("Existing piece (linkedin)");
    expect(source.draftCount).toBe(2);
  });

  it("leaves out other ideas' pieces and deleted ones", () => {
    const source = buildExtractSource(
      idea(),
      [
        piece({ id: "mine", body: "belongs here" }),
        piece({ id: "theirs", ideaId: "other", body: "belongs elsewhere" }),
        piece({ id: "gone", body: "was deleted", deletedAt: NOW }),
      ],
      [],
    );
    expect(source.text).toContain("belongs here");
    expect(source.text).not.toContain("belongs elsewhere");
    expect(source.text).not.toContain("was deleted");
    expect(source.draftCount).toBe(1);
  });

  // A resource is a reference, so what exists to send is the link and whatever
  // the writer said about it.
  it("carries a source's link and what the writer said about it", () => {
    const source = buildExtractSource(
      idea(),
      [],
      [
        resource({ url: "https://example.com/paper", note: "the numbers in part 3" }),
        resource({ id: "r2", title: "Empty", ownerId: "i1" }),
        resource({ id: "r3", ownerType: "piece", ownerId: "p1", note: "attached to a piece" }),
      ],
    );
    expect(source.text).toContain("https://example.com/paper");
    expect(source.text).toContain("the numbers in part 3");
    expect(source.text).not.toContain("attached to a piece");
    expect(source.resourceCount).toBe(2);
  });

  it("skips empty drafts rather than sending blank sections", () => {
    const source = buildExtractSource(
      idea(),
      [piece({ id: "empty", body: "   " }), piece({ id: "full", body: "real words" })],
      [],
    );
    expect(source.text).toContain("real words");
    expect(source.text.match(/## Draft:/g) ?? []).toHaveLength(1);
  });

  it("cuts an oversized idea and says that it did", () => {
    const source = buildExtractSource(
      idea(),
      [piece({ body: "x".repeat(MAX_SOURCE_CHARS + 5000) })],
      [],
    );
    expect(source.truncated).toBe(true);
    expect(source.text.length).toBe(MAX_SOURCE_CHARS);
  });

  it("refuses to ask when there is almost nothing written", () => {
    expect(hasEnoughToExtract(buildExtractSource(idea(), [], []))).toBe(false);
    expect(
      hasEnoughToExtract(buildExtractSource(idea(), [piece({ body: "a".repeat(500) })], [])),
    ).toBe(true);
  });
});

describe("extractor — reading the answer back", () => {
  const good = JSON.stringify([
    { title: "One", body: "the first idea, whole" },
    { title: "Two", body: "the second idea, whole" },
  ]);

  it("reads a clean array", () => {
    expect(parseExtracted(good)).toEqual([
      { title: "One", body: "the first idea, whole" },
      { title: "Two", body: "the second idea, whole" },
    ]);
  });

  // Models fence JSON however firmly they are told not to, and one unusable
  // response after a paid call is the worst outcome this feature has.
  it("reads an array wrapped in a code fence", () => {
    expect(parseExtracted("```json\n" + good + "\n```")).toHaveLength(2);
  });

  it("reads an array with prose around it", () => {
    expect(parseExtracted(`Here are the pieces I found:\n${good}\nHope that helps.`)).toHaveLength(2);
  });

  it("returns null for something that is not an array at all", () => {
    expect(parseExtracted("I could not find anything worth extracting.")).toBeNull();
    expect(parseExtracted('{"title":"One","body":"just one"}')).toBeNull();
    expect(parseExtracted("")).toBeNull();
  });

  // Distinct from null on purpose: the model answered correctly and said there
  // is nothing here, which is a real answer and not a failure.
  it("returns an empty list for an empty array", () => {
    expect(parseExtracted("[]")).toEqual([]);
  });

  it("drops entries with no words in them", () => {
    const mixed = JSON.stringify([
      { title: "Named but unwritten", body: "" },
      { title: "Real", body: "actual words" },
      { title: "Also unwritten" },
      "not an object",
      null,
    ]);
    expect(parseExtracted(mixed)).toEqual([{ title: "Real", body: "actual words" }]);
  });

  it("keeps a piece that has words but no title", () => {
    expect(parseExtracted(JSON.stringify([{ body: "untitled but real" }]))).toEqual([
      { title: "", body: "untitled but real" },
    ]);
  });

  it("caps how many pieces one run can create", () => {
    const many = JSON.stringify(
      Array.from({ length: MAX_EXTRACTED + 8 }, (_, i) => ({ title: `T${i}`, body: `B${i}` })),
    );
    expect(parseExtracted(many)).toHaveLength(MAX_EXTRACTED);
  });

  it("trims the whitespace models leave around fields", () => {
    expect(parseExtracted(JSON.stringify([{ title: "  Spaced  ", body: "  body  " }]))).toEqual([
      { title: "Spaced", body: "body" },
    ]);
  });
});
