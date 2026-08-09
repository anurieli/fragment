import type { Note } from "@/lib/types";
import { contentHash, optionalHash } from "./hash";
import type { MigrationPlan, SatelliteRow } from "./plan";

/**
 * The gate that decides whether a completed migration is allowed to stand.
 *
 * The migration is only ever additive: it writes fragments and ideas, and
 * leaves the notes table alone. That means a failure here is recoverable by
 * simply not retiring the old rows. So this runs after the writes and before
 * anything is retired, and a single failed check is enough to hold the whole
 * library on the old shape.
 *
 * Every check compares the result against the pre-migration snapshot, never
 * against the migration's own idea of what it did. Code that grades its own
 * homework is not a gate.
 */

export type FailureCode =
  | "missing-piece"
  | "body-mismatch"
  | "context-mismatch"
  | "missing-idea"
  | "wrong-idea"
  | "missing-legacy-id"
  | "satellite-missing"
  | "satellite-unmoved"
  | "count-mismatch";

export interface VerificationFailure {
  code: FailureCode;
  /** The note or row the failure is about, so a report can name it. */
  subject: string;
  detail: string;
}

export interface VerificationResult {
  ok: boolean;
  checked: number;
  failures: VerificationFailure[];
}

/** The post-migration shape this gate needs to see. Structural rather than
 * imported, so the gate does not have to move in lockstep with the contract. */
export interface VerifiablePiece {
  id: string;
  ideaId: string;
  body?: string;
  title?: string;
  subtitle?: string;
  goal?: string;
  audience?: string;
  tone?: string;
  remember?: string;
  voiceId?: string | null;
  legacyNoteId?: string;
  deletedAt?: number;
}

export interface VerifiableIdea {
  id: string;
  title: string;
  deletedAt?: number;
}

export interface VerifyInput {
  /** Notes exactly as they were before the migration ran. */
  before: readonly Note[];
  plan: MigrationPlan;
  pieces: readonly VerifiablePiece[];
  ideas: readonly VerifiableIdea[];
  noteVersions: readonly (SatelliteRow & { pieceId?: string })[];
  reviews: readonly (SatelliteRow & { pieceId?: string })[];
  snippets: readonly (SatelliteRow & { pieceId?: string })[];
}

/** Stop collecting once a report is long enough to be acted on. A library that
 * fails 4000 checks fails for one reason; the first few name it. */
const MAX_FAILURES = 50;

export function verifyMigration(input: VerifyInput): VerificationResult {
  const failures: VerificationFailure[] = [];
  const pieceById = new Map(input.pieces.map((piece) => [piece.id, piece]));
  const ideaById = new Map(input.ideas.map((idea) => [idea.id, idea]));
  let checked = 0;

  const fail = (code: FailureCode, subject: string, detail: string) => {
    if (failures.length < MAX_FAILURES) failures.push({ code, subject, detail });
  };

  for (const note of input.before) {
    const targetId = input.plan.noteToPiece[note.id];
    checked++;

    if (!targetId) {
      fail("missing-piece", note.id, "the plan gave this note no fragment to land in");
      continue;
    }

    const piece = pieceById.get(targetId);
    if (!piece) {
      fail("missing-piece", note.id, `fragment ${targetId} was not written`);
      continue;
    }

    if (contentHash(piece.body ?? "") !== contentHash(note.content)) {
      fail(
        "body-mismatch",
        note.id,
        `fragment ${targetId} holds ${(piece.body ?? "").length} characters, the note had ${note.content.length}`,
      );
    }

    if (piece.legacyNoteId !== note.id) {
      fail("missing-legacy-id", note.id, `fragment ${targetId} does not record where it came from`);
    }

    const contextMismatch = describeContextMismatch(note, piece);
    if (contextMismatch) fail("context-mismatch", note.id, contextMismatch);
  }

  for (const promotion of input.plan.promotions) {
    const idea = ideaById.get(promotion.ideaId);
    if (!idea) {
      fail("missing-idea", promotion.noteId, `idea ${promotion.ideaId} was not created`);
      continue;
    }
    const piece = pieceById.get(promotion.pieceId);
    if (piece && piece.ideaId !== promotion.ideaId) {
      fail("wrong-idea", promotion.noteId, `fragment landed in ${piece.ideaId}, not ${promotion.ideaId}`);
    }
  }

  for (const absorption of input.plan.absorptions) {
    const piece = pieceById.get(absorption.pieceId);
    if (piece && piece.ideaId !== absorption.ideaId) {
      fail("wrong-idea", absorption.pieceId, `fragment moved from idea ${absorption.ideaId} to ${piece.ideaId}`);
    }
  }

  checkSatellites("noteVersions", input.plan.rekeys.noteVersions, input.noteVersions, fail);
  checkSatellites("reviews", input.plan.rekeys.reviews, input.reviews, fail);
  checkSatellites("snippets", input.plan.rekeys.snippets, input.snippets, fail);

  const expectedPieces = input.plan.counts.promotions;
  const writtenPromotions = input.plan.promotions.filter((row) => pieceById.has(row.pieceId)).length;
  if (writtenPromotions !== expectedPieces) {
    fail(
      "count-mismatch",
      "promotions",
      `expected ${expectedPieces} new fragments, found ${writtenPromotions}`,
    );
  }

  return { ok: failures.length === 0, checked, failures };
}

function describeContextMismatch(note: Note, piece: VerifiablePiece): string | null {
  const fields: [string, string, string][] = [
    ["goal", optionalHash(note.goal), optionalHash(piece.goal)],
    ["audience", optionalHash(note.audience), optionalHash(piece.audience)],
    ["tone", optionalHash(note.tone), optionalHash(piece.tone)],
    ["remember", optionalHash(note.remember), optionalHash(piece.remember)],
    ["subtitle", optionalHash(note.subtitle), optionalHash(piece.subtitle)],
  ];
  const lost = fields.filter(([, before, after]) => before !== after).map(([name]) => name);

  // voiceId carries three distinct states (inherit, none, specific) and the
  // gate has to hold all three, not just "some value is present".
  if (note.voiceId !== piece.voiceId) lost.push("voiceId");

  return lost.length > 0 ? `these fields did not survive: ${lost.join(", ")}` : null;
}

function checkSatellites(
  label: string,
  expected: MigrationPlan["rekeys"]["noteVersions"],
  actual: readonly (SatelliteRow & { pieceId?: string })[],
  fail: (code: FailureCode, subject: string, detail: string) => void,
): void {
  const actualById = new Map(actual.map((row) => [row.id, row]));
  for (const rekey of expected) {
    const row = actualById.get(rekey.id);
    if (!row) {
      fail("satellite-missing", `${label}:${rekey.id}`, "row disappeared during the migration");
      continue;
    }
    if (row.pieceId !== rekey.toPieceId) {
      fail(
        "satellite-unmoved",
        `${label}:${rekey.id}`,
        `expected to point at ${rekey.toPieceId}, points at ${row.pieceId ?? "nothing"}`,
      );
    }
  }
}

/** A one-line summary for logs and the migration report. */
export function describeVerification(result: VerificationResult): string {
  if (result.ok) return `${result.checked} notes verified, no discrepancies`;
  const shown = result.failures.slice(0, 3).map((failure) => `${failure.code} (${failure.subject})`);
  return `${result.failures.length} discrepancies across ${result.checked} notes: ${shown.join("; ")}`;
}
