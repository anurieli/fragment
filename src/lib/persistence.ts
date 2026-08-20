import { db } from "./db";
import type { Snippet, PieceVersion, BrandVoice, VoiceSample, StoredReview, Comment } from "./types";
import { logPersistence } from "./persistence-logger";
import { backupPieceToFs } from "./fs-backup";
import {
  ContractError,
  assertIdeaParentAllowed,
  isLongformFormat,
  type Idea,
  type ContentPiece,
  type Resource,
} from "./content-engine";

// ---------------------------------------------------------------------------
// Snips
//
// A snip belongs either to the fragment it was cut out of or, when it was cut
// somewhere no single fragment owns, to the idea. Both loaders exist because
// the store holds a window onto the snippets table rather than all of it: the
// fragment's snips and the idea's snips are on screen together, and neither
// query alone fills the bar.
// ---------------------------------------------------------------------------

export async function loadSnippetsForPiece(pieceId: string): Promise<Snippet[]> {
  try {
    return await db.snippets.where("pieceId").equals(pieceId).sortBy("order");
  } catch {
    return [];
  }
}

export async function loadSnippetsForIdea(ideaId: string): Promise<Snippet[]> {
  try {
    return await db.snippets.where("ideaId").equals(ideaId).sortBy("order");
  } catch {
    return [];
  }
}

export async function saveSnippet(snippet: Snippet): Promise<void> {
  try {
    await db.snippets.put(snippet);
  } catch {
    // Snippet persistence failure is non-critical since snippets are cut from
    // a fragment's text and can be cut again.
  }
}

export async function deleteSnippet(id: string): Promise<void> {
  try {
    await db.snippets.delete(id);
  } catch {
    // best-effort
  }
}

/** A home's comments, oldest first. See commentHome in comment-scope.ts. */
export async function loadCommentsForPiece(pieceId: string): Promise<Comment[]> {
  try {
    return await db.comments.where("pieceId").equals(pieceId).sortBy("createdAt");
  } catch {
    return [];
  }
}

export async function loadCommentsForIdea(ideaId: string): Promise<Comment[]> {
  try {
    return await db.comments.where("ideaId").equals(ideaId).sortBy("createdAt");
  } catch {
    return [];
  }
}

export async function saveComment(comment: Comment): Promise<void> {
  try {
    await db.comments.put(comment);
  } catch {
    // Comment persistence failure is non-critical, mirrors saveSnippet.
  }
}

/**
 * The comment that seeded this idea, if any — powers the idea view's
 * "Started from a comment" backlink. A direct indexed lookup rather than a
 * scoped in-memory read: the store only ever holds the comments for
 * whichever piece/idea is currently active, and the source comment usually
 * lives under a different one.
 */
export async function findOriginComment(ideaId: string): Promise<Comment | null> {
  try {
    const match = await db.comments.where("promotedIdeaId").equals(ideaId).first();
    return match ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Versions
//
// One row per snapshot, keyed to the piece it was taken from. Rows carried
// over by the one-entity migration keep their original id and their
// legacyNoteId, so a piece that used to be a note has one continuous
// timeline rather than one that restarts on migration day.
// ---------------------------------------------------------------------------

export async function loadAllPieceVersions(): Promise<PieceVersion[]> {
  try {
    return await db.pieceVersions.toArray();
  } catch {
    return [];
  }
}

export async function loadVersionsForPiece(pieceId: string): Promise<PieceVersion[]> {
  try {
    return await db.pieceVersions.where("pieceId").equals(pieceId).reverse().sortBy("createdAt");
  } catch {
    return [];
  }
}

export async function savePieceVersion(version: PieceVersion): Promise<void> {
  try {
    await db.pieceVersions.put(version);
  } catch {
    // Version persistence failure: non-critical, the fragment itself is saved.
  }
}

export async function deletePieceVersion(id: string): Promise<void> {
  try {
    await db.pieceVersions.delete(id);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Brand Voices — metadata (voices) and raw samples (voiceSamples). IndexedDB
// only; deliberately never mirrored to localStorage.
// ---------------------------------------------------------------------------

export async function loadAllVoices(): Promise<BrandVoice[]> {
  try {
    return await db.voices.orderBy("updatedAt").toArray();
  } catch {
    return [];
  }
}

export async function saveVoice(voice: BrandVoice): Promise<void> {
  try {
    await db.voices.put(voice);
  } catch {
    // Brand Voice data is IndexedDB-only (no localStorage mirror), so a failed
    // write means silent loss on next reload. Log it — same convention as notes.
    logPersistence("voice_save_fail", { kind: "voice", id: voice.id });
  }
}

export async function deleteVoiceRow(id: string): Promise<void> {
  try {
    await db.voices.delete(id);
  } catch {
    // best-effort
  }
}

export async function loadSamplesForVoice(voiceId: string): Promise<VoiceSample[]> {
  try {
    return await db.voiceSamples.where("voiceId").equals(voiceId).sortBy("createdAt");
  } catch {
    return [];
  }
}

export async function saveSample(sample: VoiceSample): Promise<void> {
  try {
    await db.voiceSamples.put(sample);
  } catch {
    logPersistence("voice_save_fail", { kind: "sample", id: sample.id, voiceId: sample.voiceId });
  }
}

export async function saveSamples(samples: VoiceSample[]): Promise<void> {
  try {
    await db.voiceSamples.bulkPut(samples);
  } catch {
    logPersistence("voice_save_fail", { kind: "samples", count: samples.length });
  }
}

export async function deleteSample(id: string): Promise<void> {
  try {
    await db.voiceSamples.delete(id);
  } catch {
    // best-effort
  }
}

export async function deleteSamplesForVoice(voiceId: string): Promise<void> {
  try {
    await db.voiceSamples.where("voiceId").equals(voiceId).delete();
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Content Engine — ideas, content pieces, and resources. IndexedDB only, no
// localStorage mirror (same posture as Brand Voices). Store-level invariants
// from the content-engine contract are enforced here, synchronously, before
// any write is attempted, so a bad write never reaches Dexie.
// ---------------------------------------------------------------------------

/**
 * `piece.publish` must be set if and only if `piece.status === "published"`.
 * Exported so the content-store can run the same check synchronously before
 * committing an in-memory update (this function itself is awaited inside
 * `savePiece`, but a caller that wants a synchronous throw — e.g. a Zustand
 * action — should call it directly first).
 */
export function assertPublishGuard(piece: Pick<ContentPiece, "status" | "publish">): void {
  const hasPublish = piece.publish !== undefined;
  const isPublished = piece.status === "published";
  if (hasPublish !== isPublished) {
    throw new ContractError(
      `a piece's publish record must be set iff status is "published" (status: ${piece.status}, publish: ${hasPublish ? "set" : "unset"})`,
    );
  }
}

/** Internal extraction stays review-only until the dedicated accept action
 * removes reviewQueue. This backs every write path, including direct imports
 * and any UI path that forgets to hide an ordinary piece action. */
export function assertReviewQueueGuard(
  piece: Pick<ContentPiece, "reviewQueue" | "status" | "origin" | "format" | "publish">,
): void {
  if (piece.reviewQueue !== "extraction") return;
  if (
    piece.status !== "in-progress" ||
    piece.origin !== "user" ||
    isLongformFormat(piece.format) ||
    piece.publish !== undefined
  ) {
    throw new ContractError("an extraction-review piece must remain unpublished short-form work until accepted");
  }
}

/**
 * Throws on a read failure rather than returning [].
 *
 * "No ideas" and "I couldn't read your ideas" are different facts and the
 * caller has to be able to tell them apart: hydration renders the first as an
 * empty library, and the agent-inbox importer treats it as "none of these
 * pieces exist yet", re-inserts them, and then acks their source markdown out
 * of the inbox. Swallowing the error turned a transient read failure into
 * permanent divergence. See loadContentEngine in use-persistence.ts.
 */
export async function loadAllIdeas(): Promise<Idea[]> {
  return await db.ideas.toArray();
}

/** Resolves true iff the row is actually on disk. See savePiece. */
export async function saveIdea(idea: Idea): Promise<boolean> {
  // Depth guard: a child idea's parent must itself be a root idea. Checked
  // against the actual stored parent row, not the caller's assumption.
  if (idea.parentId !== null) {
    const parent = await db.ideas.get(idea.parentId);
    if (!parent) {
      throw new ContractError(`parent idea ${idea.parentId} does not exist`);
    }
    assertIdeaParentAllowed(parent);
  }

  try {
    await db.ideas.put(idea);
    return true;
  } catch {
    logPersistence("idea_save_fail", { id: idea.id });
    return false;
  }
}

/** Hard delete. The store's normal delete path tombstones (deletedAt) instead. */
export async function deleteIdeaRow(id: string): Promise<void> {
  try {
    await db.ideas.delete(id);
  } catch {
    // best-effort
  }
}

/** Throws on a read failure rather than returning []. See loadAllIdeas. */
export async function loadAllContentPieces(): Promise<ContentPiece[]> {
  return await db.contentPieces.toArray();
}

/**
 * Resolves true iff the row is actually on disk, false if IndexedDB refused
 * the write.
 *
 * Callers that own the only other copy of this piece MUST check the result.
 * The agent-inbox importer is the one that matters: it acks imported handoff
 * files, and an ack moves the source markdown into `.imported/` where nothing
 * re-imports it. Acking on the strength of a write that silently failed
 * destroys the last durable copy of a piece that only ever existed in memory.
 */
export async function savePiece(piece: ContentPiece): Promise<boolean> {
  // Stored lifecycle guards.
  assertPublishGuard(piece);
  assertReviewQueueGuard(piece);

  try {
    await db.contentPieces.put(piece);
  } catch {
    logPersistence("piece_save_fail", { id: piece.id });
    return false;
  }

  // File-system backup (Tauri only, fire-and-forget). A fragment holds the
  // writing itself now, so it inherits the safety net that used to sit under
  // notes: WebView storage can be evicted, a file on disk cannot.
  backupPieceToFs(piece);
  return true;
}

/** Hard delete. The store's normal delete path (reject) tombstones (deletedAt) instead. */
export async function deletePieceRow(id: string): Promise<void> {
  try {
    await db.contentPieces.delete(id);
  } catch {
    // best-effort
  }
}

/** Throws on a read failure rather than returning []. See loadAllIdeas. */
export async function loadAllResources(): Promise<Resource[]> {
  return await db.resources.toArray();
}

/** Resolves true iff the row is actually on disk. See savePiece. */
export async function saveResource(resource: Resource): Promise<boolean> {
  try {
    await db.resources.put(resource);
    return true;
  } catch {
    logPersistence("resource_save_fail", { id: resource.id });
    return false;
  }
}

export async function deleteResourceRow(id: string): Promise<void> {
  try {
    await db.resources.delete(id);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Pass (ARI-165): review history. Each imported `.fragment-review.json`
// becomes one row, filed under the id the share it came back from was minted
// with (see src/lib/sharing/share-key.ts).
// ---------------------------------------------------------------------------

/**
 * Every review that belongs to a fragment, newest first.
 *
 * Two keys have to be tried, not one. Reviews returned before the one-entity
 * migration carry only the note id the share was minted with, and shares stay
 * filed under that id forever so links already in someone's inbox keep
 * resolving. So a fragment's history is the union of what came back under its
 * own id and what came back under the note it used to be, deduplicated because
 * the migration stamps `pieceId` onto the old rows and they answer both
 * queries.
 */
export async function loadReviewsForPiece(pieceId: string): Promise<StoredReview[]> {
  try {
    const piece = await db.contentPieces.get(pieceId);
    const shareKeys = piece?.legacyNoteId ? [pieceId, piece.legacyNoteId] : [pieceId];

    const [byPiece, byShareKey] = await Promise.all([
      db.reviews.where("pieceId").equals(pieceId).toArray(),
      db.reviews.where("noteId").anyOf(shareKeys).toArray(),
    ]);

    const byId = new Map<string, StoredReview>();
    for (const review of [...byPiece, ...byShareKey]) byId.set(review.id, review);
    return [...byId.values()].sort((a, b) => b.receivedAt - a.receivedAt);
  } catch {
    return [];
  }
}

export async function saveReview(review: StoredReview): Promise<void> {
  try {
    await db.reviews.put(review);
  } catch {
    logPersistence("review_save_fail", { noteId: review.noteId, reviewId: review.id });
  }
}

export async function deleteReview(id: string): Promise<void> {
  try {
    await db.reviews.delete(id);
  } catch {
    // best-effort
  }
}
