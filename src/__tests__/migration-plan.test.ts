import { describe, it, expect } from "vitest";

import type { ContentPiece, Idea } from "@/lib/content-engine";
import type { Note } from "@/lib/types";
import { contentHash, optionalHash } from "@/lib/migration/hash";
import {
  buildMigrationPlan,
  deriveTitle,
  migratedIdeaId,
  migratedPieceId,
  type PlanInput,
  type SatelliteRow,
} from "@/lib/migration/plan";
import { verifyMigration, type VerifiableIdea, type VerifiablePiece } from "@/lib/migration/verify";

function note(overrides: Partial<Note> & { id: string }): Note {
  return {
    title: `Title ${overrides.id}`,
    subtitle: undefined,
    content: `Body of ${overrides.id}`,
    goal: "",
    audience: "",
    tone: "",
    remember: "",
    voiceId: undefined,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function piece(overrides: Partial<ContentPiece> & { id: string; ideaId: string }): ContentPiece {
  return {
    format: "essay",
    status: "in-progress",
    origin: "user",
    seen: true,
    priority: 0,
    order: 0,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function idea(id: string): Idea {
  return {
    id,
    title: `Idea ${id}`,
    parentId: null,
    priority: 0,
    origin: "user",
    createdAt: 1000,
    updatedAt: 1000,
  };
}

function emptyInput(overrides: Partial<PlanInput> = {}): PlanInput {
  return { notes: [], pieces: [], ideas: [], noteVersions: [], reviews: [], snippets: [], ...overrides };
}

describe("contentHash", () => {
  it("is stable for the same input", () => {
    expect(contentHash("hello world")).toBe(contentHash("hello world"));
  });

  it("separates transpositions, which a single FNV lane would collide", () => {
    expect(contentHash("ab")).not.toBe(contentHash("ba"));
  });

  it("separates the empty string from a space", () => {
    expect(contentHash("")).not.toBe(contentHash(" "));
  });

  it("keeps undefined, null and empty string distinct", () => {
    expect(optionalHash(undefined)).not.toBe(optionalHash(null));
    expect(optionalHash(null)).not.toBe(optionalHash(""));
    expect(optionalHash(undefined)).not.toBe(optionalHash(""));
  });
});

describe("deriveTitle", () => {
  it("takes the first non-empty line and strips heading marks", () => {
    expect(deriveTitle("\n\n# Hiring is trust calibration\n\nrest")).toBe("Hiring is trust calibration");
  });

  it("returns an empty string for an empty note", () => {
    expect(deriveTitle("   \n\n  ")).toBe("");
  });

  it("truncates a long first line", () => {
    const derived = deriveTitle("x".repeat(200));
    expect(derived).toHaveLength(80);
    expect(derived.endsWith("…")).toBe(true);
  });
});

describe("buildMigrationPlan", () => {
  it("promotes a note that no fragment links", () => {
    const plan = buildMigrationPlan(emptyInput({ notes: [note({ id: "n1" })] }));

    expect(plan.counts.promotions).toBe(1);
    expect(plan.counts.absorptions).toBe(0);
    expect(plan.promotions[0]).toMatchObject({
      noteId: "n1",
      ideaId: "mig-n1",
      pieceId: "migp-n1",
      titleDerived: false,
    });
    expect(plan.noteToPiece.n1).toBe("migp-n1");
  });

  it("derives a title for an untitled note", () => {
    const plan = buildMigrationPlan(
      emptyInput({ notes: [note({ id: "n1", title: "   ", content: "The real first line\nmore" })] }),
    );

    expect(plan.promotions[0].titleDerived).toBe(true);
    expect(plan.promotions[0].title).toBe("The real first line");
  });

  it("carries an empty note over rather than skipping it", () => {
    const plan = buildMigrationPlan(emptyInput({ notes: [note({ id: "n1", title: "", content: "" })] }));

    expect(plan.counts.promotions).toBe(1);
    expect(plan.counts.emptyNotes).toBe(1);
    expect(plan.noteToPiece.n1).toBe("migp-n1");
  });

  it("folds a linked note into the fragment that already points at it", () => {
    const plan = buildMigrationPlan(
      emptyInput({
        notes: [note({ id: "n1" })],
        ideas: [idea("i1")],
        pieces: [piece({ id: "p1", ideaId: "i1", noteId: "n1" })],
      }),
    );

    expect(plan.counts.promotions).toBe(0);
    expect(plan.counts.absorptions).toBe(1);
    expect(plan.absorptions[0]).toMatchObject({ noteId: "n1", pieceId: "p1", ideaId: "i1", tombstoned: false });
    expect(plan.noteToPiece.n1).toBe("p1");
  });

  it("produces identical ids on two devices given the same rows in any order", () => {
    const notes = [note({ id: "b", createdAt: 2 }), note({ id: "a", createdAt: 2 })];
    const one = buildMigrationPlan(emptyInput({ notes }));
    const two = buildMigrationPlan(emptyInput({ notes: [...notes].reverse() }));

    expect(one.promotions.map((row) => row.pieceId)).toEqual(two.promotions.map((row) => row.pieceId));
    expect(one.noteToPiece).toEqual(two.noteToPiece);
  });

  it("copies a note shared by two fragments and names the primary", () => {
    const plan = buildMigrationPlan(
      emptyInput({
        notes: [note({ id: "n1" })],
        ideas: [idea("i1"), idea("i2")],
        pieces: [
          piece({ id: "younger", ideaId: "i2", noteId: "n1", createdAt: 5000 }),
          piece({ id: "older", ideaId: "i1", noteId: "n1", createdAt: 1000 }),
        ],
      }),
    );

    expect(plan.counts.duplicates).toBe(1);
    expect(plan.noteToPiece.n1).toBe("older");
    const copy = plan.absorptions.find((row) => row.pieceId === "younger");
    expect(copy?.duplicateOf).toBe("older");
  });

  it("lets a live fragment win primary over an older tombstoned one", () => {
    const plan = buildMigrationPlan(
      emptyInput({
        notes: [note({ id: "n1" })],
        ideas: [idea("i1"), idea("i2")],
        pieces: [
          piece({ id: "dead", ideaId: "i1", noteId: "n1", createdAt: 1000, deletedAt: 2000 }),
          piece({ id: "live", ideaId: "i2", noteId: "n1", createdAt: 5000 }),
        ],
      }),
    );

    expect(plan.noteToPiece.n1).toBe("live");
    expect(plan.counts.promotions).toBe(0);
  });

  it("promotes a note whose only fragment sits in a deleted idea, and keeps the tombstoned copy", () => {
    const plan = buildMigrationPlan(
      emptyInput({
        notes: [note({ id: "n1" })],
        ideas: [idea("i1")],
        pieces: [piece({ id: "dead", ideaId: "i1", noteId: "n1", deletedAt: 2000 })],
      }),
    );

    expect(plan.counts.promotions).toBe(1);
    expect(plan.noteToPiece.n1).toBe("migp-n1");
    // The tombstoned fragment still receives the text, so restoring its idea
    // does not restore an empty draft.
    expect(plan.absorptions).toHaveLength(1);
    expect(plan.absorptions[0]).toMatchObject({ pieceId: "dead", tombstoned: true, duplicateOf: "migp-n1" });
  });

  it("reports a fragment pointing at a note that is gone", () => {
    const plan = buildMigrationPlan(
      emptyInput({ ideas: [idea("i1")], pieces: [piece({ id: "p1", ideaId: "i1", noteId: "ghost" })] }),
    );

    expect(plan.counts.orphanedPieces).toBe(1);
    expect(plan.orphanedPieces[0]).toEqual({ pieceId: "p1", missingNoteId: "ghost" });
  });

  it("re-keys satellites onto the primary fragment", () => {
    const satellites: SatelliteRow[] = [
      { id: "v1", noteId: "n1" },
      { id: "v2", noteId: "gone" },
      { id: "v3", noteId: null },
    ];
    const plan = buildMigrationPlan(
      emptyInput({
        notes: [note({ id: "n1" })],
        ideas: [idea("i1")],
        pieces: [piece({ id: "p1", ideaId: "i1", noteId: "n1" })],
        noteVersions: satellites,
        reviews: [{ id: "r1", noteId: "n1" }],
        snippets: [{ id: "s1", noteId: "n1" }],
      }),
    );

    expect(plan.rekeys.noteVersions).toEqual([{ id: "v1", fromNoteId: "n1", toPieceId: "p1" }]);
    expect(plan.rekeys.reviews[0].toPieceId).toBe("p1");
    expect(plan.rekeys.snippets[0].toPieceId).toBe("p1");
    // v2 points at a note that no longer exists, v3 is idea-scoped already.
    expect(plan.counts.unmappedSatellites).toBe(1);
  });

  it("maps every note to some fragment, which is the whole promise", () => {
    const notes = [note({ id: "a" }), note({ id: "b" }), note({ id: "c" })];
    const plan = buildMigrationPlan(
      emptyInput({
        notes,
        ideas: [idea("i1")],
        pieces: [piece({ id: "p1", ideaId: "i1", noteId: "b" })],
      }),
    );

    for (const row of notes) expect(plan.noteToPiece[row.id]).toBeTruthy();
    expect(migratedIdeaId("a")).toBe("mig-a");
    expect(migratedPieceId("a")).toBe("migp-a");
  });
});

/** Apply a plan the way the real migration will, so the gate has something
 * honest to grade. Kept deliberately simple: if this and the production
 * migration ever disagree, the gate is what catches it. */
function applyPlan(input: PlanInput, plan: ReturnType<typeof buildMigrationPlan>) {
  const noteById = new Map(input.notes.map((row) => [row.id, row]));
  const pieces: VerifiablePiece[] = [];
  const ideas: VerifiableIdea[] = input.ideas.map((row) => ({ id: row.id, title: row.title }));

  for (const promotion of plan.promotions) {
    const source = noteById.get(promotion.noteId);
    if (!source) continue;
    ideas.push({ id: promotion.ideaId, title: promotion.title });
    pieces.push({
      id: promotion.pieceId,
      ideaId: promotion.ideaId,
      body: source.content,
      title: promotion.title,
      subtitle: source.subtitle,
      goal: source.goal,
      audience: source.audience,
      tone: source.tone,
      remember: source.remember,
      voiceId: source.voiceId,
      legacyNoteId: source.id,
    });
  }

  for (const absorption of plan.absorptions) {
    const source = noteById.get(absorption.noteId);
    if (!source) continue;
    pieces.push({
      id: absorption.pieceId,
      ideaId: absorption.ideaId,
      body: source.content,
      title: source.title,
      subtitle: source.subtitle,
      goal: source.goal,
      audience: source.audience,
      tone: source.tone,
      remember: source.remember,
      voiceId: source.voiceId,
      legacyNoteId: source.id,
      deletedAt: absorption.tombstoned ? 2000 : undefined,
    });
  }

  const rekey = (rows: readonly SatelliteRow[]) =>
    rows.map((row) => ({ ...row, pieceId: row.noteId ? plan.noteToPiece[row.noteId] : undefined }));

  return {
    pieces,
    ideas,
    noteVersions: rekey(input.noteVersions),
    reviews: rekey(input.reviews),
    snippets: rekey(input.snippets),
  };
}

describe("verifyMigration", () => {
  const input = emptyInput({
    notes: [
      note({ id: "n1", goal: "persuade", audience: "founders", tone: "dry", remember: "be brief", voiceId: null }),
      note({ id: "n2", subtitle: "a dek" }),
    ],
    ideas: [idea("i1")],
    pieces: [piece({ id: "p1", ideaId: "i1", noteId: "n2" })],
    noteVersions: [{ id: "v1", noteId: "n1" }],
    reviews: [{ id: "r1", noteId: "n2" }],
    snippets: [{ id: "s1", noteId: "n1" }],
  });

  it("passes when every note landed intact", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.checked).toBe(2);
  });

  it("catches a truncated body", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);
    const target = after.pieces.find((row) => row.legacyNoteId === "n1");
    if (target) target.body = target.body?.slice(0, 3);

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.ok).toBe(false);
    expect(result.failures.map((row) => row.code)).toContain("body-mismatch");
  });

  it("catches a fragment that never got written", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);
    after.pieces = after.pieces.filter((row) => row.legacyNoteId !== "n1");

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.failures.map((row) => row.code)).toContain("missing-piece");
  });

  it("catches lost context fields", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);
    const target = after.pieces.find((row) => row.legacyNoteId === "n1");
    if (target) target.tone = "";

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.ok).toBe(false);
    expect(result.failures[0].detail).toContain("tone");
  });

  it("treats an explicit no-voice as different from an inherited one", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);
    const target = after.pieces.find((row) => row.legacyNoteId === "n1");
    if (target) target.voiceId = undefined;

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.failures[0].detail).toContain("voiceId");
  });

  it("catches a fragment that forgot where it came from", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);
    const target = after.pieces.find((row) => row.legacyNoteId === "n2");
    if (target) target.legacyNoteId = undefined;

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.failures.map((row) => row.code)).toContain("missing-legacy-id");
  });

  it("catches a satellite that stayed behind", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);
    after.noteVersions = after.noteVersions.map((row) => ({ ...row, pieceId: undefined }));

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.failures.map((row) => row.code)).toContain("satellite-unmoved");
  });

  it("catches a satellite that vanished", () => {
    const plan = buildMigrationPlan(input);
    const after = applyPlan(input, plan);
    after.reviews = [];

    const result = verifyMigration({ before: input.notes, plan, ...after });

    expect(result.failures.map((row) => row.code)).toContain("satellite-missing");
  });
});
