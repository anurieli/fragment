import { describe, it, expect } from "vitest";

import {
  DRAFT_FORMAT,
  PIECE_FORMAT,
  moveToSection,
  sectionOf,
} from "@/lib/piece-section";
import type { ContentPiece } from "@/lib/content-engine";

function makePiece(overrides: Partial<ContentPiece> = {}): ContentPiece {
  return {
    id: "piece-1",
    ideaId: "idea-1",
    format: "other",
    status: "in-progress",
    origin: "user",
    body: "Some words.",
    seen: true,
    priority: 0,
    order: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe("sectionOf", () => {
  it("puts long-form formats in Drafts", () => {
    for (const format of ["essay", "substack", "script"] as const) {
      expect(sectionOf(makePiece({ format }))).toBe("drafts");
    }
  });

  it("puts short-form formats in Pieces", () => {
    for (const format of ["linkedin", "tweet", "other"] as const) {
      expect(sectionOf(makePiece({ format }))).toBe("pieces");
    }
  });
});

describe("moveToSection", () => {
  it("is a no-op when the fragment is already in that list", () => {
    expect(moveToSection(makePiece({ format: "essay" }), "drafts")).toBeNull();
    expect(moveToSection(makePiece({ format: "tweet" }), "pieces")).toBeNull();
  });

  it("changes format and nothing else, in both directions", () => {
    expect(moveToSection(makePiece({ format: "tweet" }), "drafts")).toEqual({
      format: DRAFT_FORMAT,
    });
    expect(moveToSection(makePiece({ format: "essay" }), "pieces")).toEqual({
      format: PIECE_FORMAT,
    });
  });

  it("triages an inbox piece on the way into Drafts", () => {
    expect(
      moveToSection(makePiece({ format: "linkedin", status: "inbox" }), "drafts"),
    ).toEqual({ format: DRAFT_FORMAT, status: "in-progress" });
  });

  it("leaves any other status alone on the way into Drafts", () => {
    for (const status of ["in-progress", "ready", "published"] as const) {
      expect(moveToSection(makePiece({ format: "tweet", status }), "drafts")).toEqual({
        format: DRAFT_FORMAT,
      });
    }
  });

  it("never touches a draft's status on the way into Pieces", () => {
    for (const status of ["in-progress", "ready", "published"] as const) {
      const change = moveToSection(makePiece({ format: "essay", status }), "pieces");
      expect(change).toEqual({ format: PIECE_FORMAT });
      expect(change).not.toHaveProperty("status");
    }
  });

  it("round-trips a fragment back to the list it started in", () => {
    const piece = makePiece({ format: "essay" });
    const out = moveToSection(piece, "pieces");
    expect(out).not.toBeNull();
    const landed = { ...piece, ...out! };
    expect(sectionOf(landed)).toBe("pieces");

    const back = moveToSection(landed, "drafts");
    expect(back).not.toBeNull();
    expect(sectionOf({ ...landed, ...back! })).toBe("drafts");
  });

  it("cannot give a short-form piece its platform back after a round trip", () => {
    // The documented cost of storing the section as format: Drafts has
    // nowhere to keep "linkedin", so only Undo restores it.
    const piece = makePiece({ format: "linkedin" });
    const asDraft = { ...piece, ...moveToSection(piece, "drafts")! };
    const backAgain = { ...asDraft, ...moveToSection(asDraft, "pieces")! };
    expect(backAgain.format).toBe("other");
  });
});
