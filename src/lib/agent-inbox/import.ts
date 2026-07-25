/**
 * The agent-inbox import pipeline: pure functions that turn raw handoff
 * files (already read from disk, by the HTTP route or the Tauri fs reader)
 * into store writes.
 *
 * Deliberately pure — no Dexie, no Zustand, no clocks, no ids generated
 * internally — so the whole pipeline is unit-testable with plain fixtures,
 * and so the same logic can run in the browser (fetch-based ingress) and in
 * Tauri (direct fs reads) without duplication.
 */

import {
  buildIdeaFromHandoff,
  buildResources,
  handoffToPiece,
  matchIdea,
  parsePieceFile,
  resolvePieceUpsert,
  resourceLineSchema,
  type ContentPiece,
  type Idea,
  type Resource,
} from "@/lib/content-engine";

export interface AgentInboxFile {
  fileName: string;
  /** Path relative to the inbox directory — echoed back on ack. */
  relPath: string;
  content: string;
  /** Epoch ms file modification time. */
  mtime: number;
}

export interface ImportHandoffContext {
  ideas: readonly Idea[];
  pieces: readonly ContentPiece[];
  now: number;
  generateId: () => string;
}

export interface ImportSkip {
  relPath: string;
  reason: "parse-error" | "local-newer" | "unchanged" | "local-deleted";
  detail?: string;
}

export interface ImportHandoffResult {
  ideasToCreate: Idea[];
  piecesToUpsert: ContentPiece[];
  resourcesToCreate: Resource[];
  /** relPaths that were fully understood (imported or safely no-op) and
   * should be acked (moved to `.imported/`). Parse failures are excluded —
   * they stay in the inbox so a corrected re-push can be retried. */
  acks: string[];
  skips: ImportSkip[];
}

/**
 * Import a batch of handoff files against the current ideas/pieces state.
 *
 * Per file:
 *  1. Parse the frontmatter+body. A malformed file is skipped and NOT
 *     acked (left in the inbox for the agent/user to fix).
 *  2. Resolve the target idea: match by id/title against both the existing
 *     store state and ideas created earlier in this same batch, or create a
 *     new root idea.
 *  3. Build the candidate piece and resolve the upsert against any existing
 *     piece with the same id (last-write-wins on updatedAt; a locally newer
 *     or already-deleted piece is never clobbered). Skips are still acked —
 *     the file was understood, there's just nothing to write.
 *  4. If the handoff declares `supersedes` and that piece exists and is
 *     still in "inbox", tombstone it (deletedAt) as part of this import.
 *     Otherwise the superseded piece is left untouched and the new piece
 *     lands as a fresh inbox item.
 *
 * Idempotent: re-running with the same files against the resulting state
 * (real, or simulated by folding the returned piecesToUpsert/ideasToCreate
 * back into the ctx) is a no-op — every insert becomes an "unchanged" skip.
 */
export function importHandoffFiles(
  files: readonly AgentInboxFile[],
  ctx: ImportHandoffContext,
): ImportHandoffResult {
  const ideasToCreate: Idea[] = [];
  const piecesToUpsert: ContentPiece[] = [];
  const resourcesToCreate: Resource[] = [];
  const acks: string[] = [];
  const skips: ImportSkip[] = [];

  // Working snapshots so the batch is internally consistent: a file later in
  // the batch can match an idea (or see a piece) created/updated by an
  // earlier file in the SAME batch, not just pre-import state.
  const workingIdeas: Idea[] = [...ctx.ideas];
  const workingPieces = new Map<string, ContentPiece>(ctx.pieces.map((p) => [p.id, p]));

  for (const file of files) {
    let handoff;
    try {
      handoff = parsePieceFile(file.content);
    } catch (error) {
      skips.push({
        relPath: file.relPath,
        reason: "parse-error",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    // Idea resolution ------------------------------------------------------
    let ideaId: string;
    const matched = matchIdea(handoff, workingIdeas);
    if (matched) {
      ideaId = matched.id;
    } else {
      const newIdea = buildIdeaFromHandoff(handoff, { now: ctx.now, generateId: ctx.generateId });
      ideasToCreate.push(newIdea);
      workingIdeas.push(newIdea);
      ideaId = newIdea.id;
    }

    // Piece resolution -------------------------------------------------------
    const siblingMaxOrder = [...workingPieces.values()]
      .filter((p) => p.ideaId === ideaId)
      .reduce((max, p) => Math.max(max, p.order), -1);

    const candidate = handoffToPiece(handoff, {
      now: ctx.now,
      generateId: ctx.generateId,
      ideaId,
      order: siblingMaxOrder + 1,
    });

    const existing = workingPieces.get(candidate.id);
    const action = resolvePieceUpsert({ updatedAt: candidate.updatedAt }, existing);

    if (action.action === "skip") {
      skips.push({ relPath: file.relPath, reason: action.reason });
      acks.push(file.relPath);
    } else {
      piecesToUpsert.push(candidate);
      workingPieces.set(candidate.id, candidate);
      if (action.action === "insert") {
        resourcesToCreate.push(
          ...buildResources(handoff, { type: "piece", id: candidate.id }, { now: ctx.now, generateId: ctx.generateId }),
        );
      }
      acks.push(file.relPath);
    }

    // Supersedes -------------------------------------------------------------
    if (handoff.supersedes) {
      const superseded = workingPieces.get(handoff.supersedes);
      if (superseded && superseded.status === "inbox" && superseded.deletedAt === undefined) {
        const tombstoned: ContentPiece = { ...superseded, deletedAt: ctx.now, updatedAt: ctx.now };
        piecesToUpsert.push(tombstoned);
        workingPieces.set(tombstoned.id, tombstoned);
      }
      // Else: superseded piece is missing, already deleted, or has moved
      // past "inbox" (in-progress/ready/published) — leave it alone. The
      // new piece has already landed above as a fresh inbox item.
    }
  }

  return { ideasToCreate, piecesToUpsert, resourcesToCreate, acks, skips };
}

// ---------------------------------------------------------------------------
// resources.jsonl import (ARI-162) — the sibling ingress path to the piece
// handoff files above. fragment-mcp's `add_resource` tool appends one JSON
// line per call to `<ideaId>/resources.jsonl`; this reads a whole file's
// lines back and turns them into Resource rows to upsert.
// ---------------------------------------------------------------------------

export interface AgentResourceFile {
  /** The idea directory this resources.jsonl lives under (not necessarily
   * the owning idea of every line — a piece-owned resource's ownerId is the
   * piece, not this directory; the directory is just where it's filed). */
  ideaId: string;
  /** Path relative to the inbox directory — echoed back on ack. */
  relPath: string;
  content: string;
  /** Epoch ms file modification time. */
  mtime: number;
}

export interface ImportResourceLinesContext {
  /** Ids of resources already in the store — a line whose id is already
   * known is skipped, which is what makes re-importing the same
   * resources.jsonl file idempotent. */
  existingResourceIds: ReadonlySet<string>;
  now: number;
  generateId: () => string;
}

export interface ImportResourceLinesResult {
  resourcesToUpsert: Resource[];
  /** relPaths fully consumed and safe to ack (moved to `.imported/`), same
   * contract as importHandoffFiles' acks — a file is acked once every line
   * in it has been read, even if some lines were malformed and skipped. */
  acks: string[];
  skips: ImportSkip[];
}

/**
 * Import a batch of `resources.jsonl` files. Per line: parse as JSON,
 * validate with the contract's `resourceLineSchema`, fill in `id`/`createdAt`
 * when the line omits them (fragment-mcp always sets both, but a
 * hand-written line may not), and skip anything whose id is already known —
 * across this batch or from the store passed in via `existingResourceIds`.
 * A malformed line is skipped, not fatal to the rest of the file.
 */
export function importResourceLines(
  files: readonly AgentResourceFile[],
  ctx: ImportResourceLinesContext,
): ImportResourceLinesResult {
  const resourcesToUpsert: Resource[] = [];
  const acks: string[] = [];
  const skips: ImportSkip[] = [];
  const seenIds = new Set(ctx.existingResourceIds);

  for (const file of files) {
    const lines = file.content.split("\n");
    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;

      let json: unknown;
      try {
        json = JSON.parse(trimmed);
      } catch (error) {
        skips.push({
          relPath: file.relPath,
          reason: "parse-error",
          detail: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      const parsed = resourceLineSchema.safeParse(json);
      if (!parsed.success) {
        skips.push({
          relPath: file.relPath,
          reason: "parse-error",
          detail: parsed.error.message,
        });
        continue;
      }

      const line = parsed.data;
      const id = line.id ?? ctx.generateId();
      if (seenIds.has(id)) {
        skips.push({ relPath: file.relPath, reason: "unchanged" });
        continue;
      }
      seenIds.add(id);

      resourcesToUpsert.push({
        id,
        ownerType: line.ownerType,
        ownerId: line.ownerId,
        kind: line.kind,
        url: line.url,
        title: line.title,
        note: line.note,
        createdAt: line.createdAt ?? ctx.now,
      });
    }

    // Every file that was read (regardless of per-line outcomes) is acked —
    // reads are best-effort/eventually-consistent, same posture as
    // importHandoffFiles, and there is no "fix and re-push" retry path for a
    // resources.jsonl line the way there is for a piece file.
    acks.push(file.relPath);
  }

  return { resourcesToUpsert, acks, skips };
}
