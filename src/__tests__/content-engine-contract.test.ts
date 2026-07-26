import { describe, it, expect } from "vitest";

import {
  CONTENT_FORMATS,
  ContractError,
  assertIdeaParentAllowed,
  contentPieceSchema,
  isLongformFormat,
  parsePieceHandoffJson,
  pieceContentHome,
} from "@/lib/content-engine";
import type { ContentPiece, Idea } from "@/lib/content-engine";

const validJson = {
  fragment: 1,
  ideaTitle: "Agents that respect your voice",
  format: "linkedin",
  body: "Draft body.",
};

describe("content-engine — long-form formats", () => {
  it("counts essay, substack, and script as long-form", () => {
    expect(isLongformFormat("essay")).toBe(true);
    expect(isLongformFormat("substack")).toBe(true);
    expect(isLongformFormat("script")).toBe(true);
  });

  it("leaves the feed formats short-form", () => {
    expect(isLongformFormat("tweet")).toBe(false);
    expect(isLongformFormat("linkedin")).toBe(false);
    expect(isLongformFormat("other")).toBe(false);
  });

  it("classifies every format in the contract, one way or the other", () => {
    for (const format of CONTENT_FORMATS) {
      expect(typeof isLongformFormat(format)).toBe("boolean");
    }
  });
});

describe("content-engine — JSON handoff schema", () => {
  it("parses a minimal body and applies defaults", () => {
    const handoff = parsePieceHandoffJson(validJson);
    expect(handoff.status).toBe("inbox");
    expect(handoff.origin).toBe("agent");
    expect(handoff.priority).toBe(0);
    expect(handoff.resources).toEqual([]);
    expect(handoff.body).toBe("Draft body.");
  });

  it("accepts ISO-8601 timestamps and converts to epoch ms", () => {
    const handoff = parsePieceHandoffJson({
      ...validJson,
      createdAt: "2026-07-20T12:00:00.000Z",
      scheduledAt: 1753617600000,
    });
    expect(handoff.createdAt).toBe(Date.parse("2026-07-20T12:00:00.000Z"));
    expect(handoff.scheduledAt).toBe(1753617600000);
  });

  it("rejects an unsupported contract version", () => {
    expect(() => parsePieceHandoffJson({ ...validJson, fragment: 2 })).toThrow(
      /unsupported contract version 2/,
    );
  });

  it("rejects a piece with neither ideaId nor ideaTitle", () => {
    expect(() =>
      parsePieceHandoffJson({ fragment: 1, format: "tweet", body: "hi" }),
    ).toThrow(ContractError);
  });

  it("rejects out-of-range priority and unknown formats", () => {
    expect(() => parsePieceHandoffJson({ ...validJson, priority: 5 })).toThrow(ContractError);
    expect(() => parsePieceHandoffJson({ ...validJson, format: "medium" })).toThrow(
      ContractError,
    );
  });

  it("accepts resources with kind/url/title/note", () => {
    const handoff = parsePieceHandoffJson({
      ...validJson,
      resources: [{ kind: "link", url: "https://example.com", title: "Inspiration" }],
    });
    expect(handoff.resources).toHaveLength(1);
    expect(handoff.resources[0].kind).toBe("link");
  });
});

describe("content-engine — stored piece rules", () => {
  const basePiece: ContentPiece = {
    id: "p1",
    ideaId: "i1",
    format: "tweet",
    status: "inbox",
    origin: "agent",
    body: "text",
    seen: false,
    priority: 0,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  };

  it("requires exactly one content home", () => {
    expect(contentPieceSchema.safeParse(basePiece).success).toBe(true);
    expect(
      contentPieceSchema.safeParse({ ...basePiece, noteId: "n1" }).success,
    ).toBe(false);
    const { body: _body, ...noHome } = basePiece;
    expect(contentPieceSchema.safeParse(noHome).success).toBe(false);
  });

  it("pieceContentHome names the home and throws on violations", () => {
    expect(pieceContentHome({ body: "x" })).toBe("body");
    expect(pieceContentHome({ noteId: "n1" })).toBe("note");
    expect(() => pieceContentHome({})).toThrow(ContractError);
    expect(() => pieceContentHome({ noteId: "n1", body: "x" })).toThrow(ContractError);
  });
});

describe("content-engine — idea nesting", () => {
  const root: Pick<Idea, "id" | "parentId" | "deletedAt"> = { id: "i1", parentId: null };

  it("allows parenting under a root idea", () => {
    expect(() => assertIdeaParentAllowed(root)).not.toThrow();
  });

  it("rejects a parent that is itself a child (max depth 2)", () => {
    expect(() => assertIdeaParentAllowed({ id: "i2", parentId: "i1" })).toThrow(
      /at most one level/,
    );
  });

  it("rejects a deleted parent", () => {
    expect(() => assertIdeaParentAllowed({ ...root, deletedAt: 5 })).toThrow(/deleted/);
  });
});
