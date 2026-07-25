import { db } from "./db";
import type { Note, Snippet, NoteVersion, BrandVoice, VoiceSample } from "./types";
import { logPersistence, summarizeNotes } from "./persistence-logger";
import { backupNoteToFs, removeNoteFromFs, loadNotesFromFs } from "./fs-backup";
import {
  ContractError,
  pieceContentHome,
  assertIdeaParentAllowed,
  type Idea,
  type ContentPiece,
  type Resource,
} from "./content-engine";

// ---------------------------------------------------------------------------
// localStorage backup keys for notes (belt-and-suspenders)
// ---------------------------------------------------------------------------

const NOTE_BACKUP_PREFIX = "fragment:note:";
const NOTES_INDEX_KEY = "fragment:notes:index";

function noteBackupKey(id: string): string {
  return `${NOTE_BACKUP_PREFIX}${id}`;
}

/** Write a note to localStorage as a backup. Best-effort, never throws. */
function backupNoteToLocal(note: Note): void {
  try {
    localStorage.setItem(noteBackupKey(note.id), JSON.stringify(note));
    // Update the index of known note IDs
    const index = loadNoteIndex();
    if (!index.includes(note.id)) {
      index.push(note.id);
      localStorage.setItem(NOTES_INDEX_KEY, JSON.stringify(index));
    }
  } catch {
    // localStorage full or unavailable — silent
  }
}

/** Remove a note's localStorage backup. */
function removeNoteBackup(noteId: string): void {
  try {
    localStorage.removeItem(noteBackupKey(noteId));
    const index = loadNoteIndex().filter((id) => id !== noteId);
    localStorage.setItem(NOTES_INDEX_KEY, JSON.stringify(index));
  } catch {
    // silent
  }
}

/** Load the index of backed-up note IDs from localStorage. */
function loadNoteIndex(): string[] {
  try {
    const raw = localStorage.getItem(NOTES_INDEX_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

/** Load all notes from localStorage backup. Used as fallback when IndexedDB fails. */
function loadNotesFromLocalBackup(): Note[] {
  const index = loadNoteIndex();
  const notes: Note[] = [];
  for (const id of index) {
    try {
      const raw = localStorage.getItem(noteBackupKey(id));
      if (raw) {
        notes.push(JSON.parse(raw) as Note);
      }
    } catch {
      // corrupt entry — skip
    }
  }
  return notes.sort((a, b) => b.updatedAt - a.updatedAt);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export async function loadAllNotes(): Promise<Note[]> {
  logPersistence("hydrate_start", {});

  try {
    const notes = await db.notes.orderBy("updatedAt").reverse().toArray();

    // Reconcile: merge notes from localStorage backup that are either missing
    // from IndexedDB or have newer content (e.g. if the last IndexedDB write
    // didn't complete before page unload).
    const dbMap = new Map(notes.map((n) => [n.id, n]));
    const localNotes = loadNotesFromLocalBackup();
    let merged = false;
    for (const ln of localNotes) {
      const dbNote = dbMap.get(ln.id);
      if (!dbNote) {
        // Note missing from IndexedDB — restore it
        notes.push(ln);
        try { await db.notes.put(ln); } catch { /* best-effort */ }
        merged = true;
      } else if (ln.updatedAt > dbNote.updatedAt) {
        // localStorage has a newer version — the IndexedDB write likely
        // didn't complete before the page unloaded. Use localStorage version.
        const staleTimestamp = dbNote.updatedAt;
        Object.assign(dbNote, ln);
        try { await db.notes.put(ln); } catch { /* best-effort */ }
        logPersistence("note_recovery", {
          noteId: ln.id,
          reason: "localStorage newer than IndexedDB",
          localUpdatedAt: new Date(ln.updatedAt).toISOString(),
          dbUpdatedAt: new Date(staleTimestamp).toISOString(),
          contentLength: ln.content.length,
        });
        merged = true;
      }
    }

    // Last-resort: if both IndexedDB and localStorage are empty, try FS backup
    if (notes.length === 0) {
      const fsNotes = await loadNotesFromFs();
      for (const fn of fsNotes) {
        notes.push(fn);
        try { await db.notes.put(fn); } catch { /* best-effort */ }
        backupNoteToLocal(fn);
      }
      if (fsNotes.length > 0) merged = true;
    }

    if (merged) {
      notes.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    // Refresh localStorage backup to match the authoritative set
    for (const note of notes) {
      backupNoteToLocal(note);
    }

    logPersistence("hydrate_complete", {
      source: "indexeddb",
      localRecovered: localNotes.filter((ln) => !dbMap.has(ln.id)).length,
      ...summarizeNotes(notes),
    });

    return notes;
  } catch {
    // IndexedDB completely unavailable — fall back to localStorage
    const localNotes = loadNotesFromLocalBackup();

    // If localStorage is also empty, try FS backup
    if (localNotes.length === 0) {
      const fsNotes = await loadNotesFromFs();
      if (fsNotes.length > 0) {
        logPersistence("hydrate_complete", {
          source: "fs_backup",
          ...summarizeNotes(fsNotes),
        });
        return fsNotes;
      }
    }

    logPersistence("hydrate_complete", {
      source: "localstorage_fallback",
      ...summarizeNotes(localNotes),
    });
    return localNotes;
  }
}

export async function loadSnippetsForNote(noteId: string): Promise<Snippet[]> {
  try {
    return await db.snippets.where("noteId").equals(noteId).sortBy("order");
  } catch {
    return [];
  }
}

export async function saveNote(note: Note): Promise<void> {
  // Always write to localStorage backup first (synchronous, reliable)
  backupNoteToLocal(note);

  // Then write to IndexedDB (async, may fail)
  try {
    await db.notes.put(note);
  } catch {
    logPersistence("note_save_fail", {
      noteId: note.id,
      title: note.title.slice(0, 50),
      contentLength: note.content.length,
    });
    // IndexedDB write failed — the localStorage backup is the safety net.
    // The caller (data-store) may choose to surface this to the user.
    throw new Error("Failed to save note to database");
  }

  // Write to file-system backup (Tauri only, fire-and-forget)
  backupNoteToFs(note);
}

export async function deleteNoteAndSnippets(noteId: string): Promise<void> {
  logPersistence("note_delete", { noteId });
  removeNoteBackup(noteId);
  removeNoteFromFs(noteId);

  try {
    await db.transaction(
      "rw",
      db.notes,
      db.snippets,
      db.noteVersions,
      db.contentPieces,
      async () => {
        await db.notes.delete(noteId);
        await db.snippets.where("noteId").equals(noteId).delete();
        await db.noteVersions.where("noteId").equals(noteId).delete();

        // A content piece whose content home is this Note loses its home.
        // Tombstone it (deletedAt) rather than hard-deleting — the piece row
        // (and its history) survives for undo, same as a rejected piece.
        const now = Date.now();
        await db.contentPieces
          .where("noteId")
          .equals(noteId)
          .modify((piece) => {
            piece.deletedAt = now;
            piece.updatedAt = now;
          });
      },
    );
  } catch {
    // Best-effort — the note is already removed from the in-memory store
  }
}

export async function saveSnippet(snippet: Snippet): Promise<void> {
  try {
    await db.snippets.put(snippet);
  } catch {
    // Snippet persistence failure is non-critical since snippets are derived
    // from note content and can be recreated.
  }
}

export async function deleteSnippet(id: string): Promise<void> {
  try {
    await db.snippets.delete(id);
  } catch {
    // best-effort
  }
}

export async function loadVersionsForNote(noteId: string): Promise<NoteVersion[]> {
  try {
    return await db.noteVersions.where("noteId").equals(noteId).reverse().sortBy("createdAt");
  } catch {
    return [];
  }
}

export async function saveVersion(version: NoteVersion): Promise<void> {
  try {
    await db.noteVersions.put(version);
  } catch {
    // Version persistence failure — non-critical
  }
}

export async function deleteVersion(id: string): Promise<void> {
  try {
    await db.noteVersions.delete(id);
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

export async function loadAllIdeas(): Promise<Idea[]> {
  try {
    return await db.ideas.toArray();
  } catch {
    return [];
  }
}

export async function saveIdea(idea: Idea): Promise<void> {
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
  } catch {
    logPersistence("idea_save_fail", { id: idea.id });
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

export async function loadAllContentPieces(): Promise<ContentPiece[]> {
  try {
    return await db.contentPieces.toArray();
  } catch {
    return [];
  }
}

export async function savePiece(piece: ContentPiece): Promise<void> {
  // Exactly-one-content-home guard (noteId XOR body).
  pieceContentHome(piece);
  // Publish-record guard.
  assertPublishGuard(piece);

  try {
    await db.contentPieces.put(piece);
  } catch {
    logPersistence("piece_save_fail", { id: piece.id });
  }
}

/** Hard delete. The store's normal delete path (reject) tombstones (deletedAt) instead. */
export async function deletePieceRow(id: string): Promise<void> {
  try {
    await db.contentPieces.delete(id);
  } catch {
    // best-effort
  }
}

export async function loadAllResources(): Promise<Resource[]> {
  try {
    return await db.resources.toArray();
  } catch {
    return [];
  }
}

export async function saveResource(resource: Resource): Promise<void> {
  try {
    await db.resources.put(resource);
  } catch {
    logPersistence("resource_save_fail", { id: resource.id });
  }
}

export async function deleteResourceRow(id: string): Promise<void> {
  try {
    await db.resources.delete(id);
  } catch {
    // best-effort
  }
}
