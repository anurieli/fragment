/**
 * Tauri file-system backup for notes.
 *
 * Writes notes as individual JSON files to the app's local data directory.
 * Immune to WebView storage eviction — files persist until explicitly deleted.
 * Only active when running inside a Tauri webview; no-ops in browser.
 */

import type { Note } from "./types";
import { isTauri } from "./ai-client";
import { logPersistence } from "./persistence-logger";

const NOTES_DIR = "notes";

/** Lazy-loaded Tauri FS module. Null in browser. */
async function getTauriFs() {
  if (!isTauri()) return null;
  try {
    return await import("@tauri-apps/plugin-fs");
  } catch {
    return null;
  }
}

/** Ensure the notes backup directory exists. */
async function ensureNotesDir(): Promise<boolean> {
  const fs = await getTauriFs();
  if (!fs) return false;
  try {
    const exists = await fs.exists(NOTES_DIR, { baseDir: fs.BaseDirectory.AppLocalData });
    if (!exists) {
      await fs.mkdir(NOTES_DIR, { baseDir: fs.BaseDirectory.AppLocalData, recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/** Save a single note to the file system. Best-effort, never throws. */
export async function backupNoteToFs(note: Note): Promise<void> {
  if (!isTauri()) return;
  try {
    const dirReady = await ensureNotesDir();
    if (!dirReady) return;

    const fs = await getTauriFs();
    if (!fs) return;

    const filePath = `${NOTES_DIR}/${note.id}.json`;
    await fs.writeTextFile(filePath, JSON.stringify(note), {
      baseDir: fs.BaseDirectory.AppLocalData,
    });

    logPersistence("fs_backup_save", { noteId: note.id, contentLength: note.content.length });
  } catch (err) {
    logPersistence("fs_backup_fail", {
      op: "save",
      noteId: note.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Remove a note's file-system backup. Best-effort, never throws. */
export async function removeNoteFromFs(noteId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const fs = await getTauriFs();
    if (!fs) return;

    const filePath = `${NOTES_DIR}/${noteId}.json`;
    const exists = await fs.exists(filePath, { baseDir: fs.BaseDirectory.AppLocalData });
    if (exists) {
      await fs.remove(filePath, { baseDir: fs.BaseDirectory.AppLocalData });
    }
  } catch {
    // best-effort
  }
}

/**
 * Load all notes from the file-system backup.
 * Used as a last-resort fallback when both IndexedDB and localStorage are empty.
 */
export async function loadNotesFromFs(): Promise<Note[]> {
  if (!isTauri()) return [];
  try {
    const fs = await getTauriFs();
    if (!fs) return [];

    const dirExists = await fs.exists(NOTES_DIR, { baseDir: fs.BaseDirectory.AppLocalData });
    if (!dirExists) return [];

    const entries = await fs.readDir(NOTES_DIR, { baseDir: fs.BaseDirectory.AppLocalData });
    const notes: Note[] = [];

    for (const entry of entries) {
      if (!entry.name?.endsWith(".json")) continue;
      try {
        const content = await fs.readTextFile(`${NOTES_DIR}/${entry.name}`, {
          baseDir: fs.BaseDirectory.AppLocalData,
        });
        const note = JSON.parse(content) as Note;
        notes.push(note);
      } catch {
        // corrupt file — skip
      }
    }

    notes.sort((a, b) => b.updatedAt - a.updatedAt);

    logPersistence("fs_backup_load", { count: notes.length });
    return notes;
  } catch (err) {
    logPersistence("fs_backup_fail", {
      op: "load",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
