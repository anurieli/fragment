/**
 * Tauri file-system backup for fragments.
 *
 * Writes fragments as individual JSON files to the app's local data directory.
 * Immune to WebView storage eviction: files persist until explicitly deleted.
 * Only active when running inside a Tauri webview; no-ops in browser.
 */

import type { ContentPiece } from "./content-engine";
import { isTauri } from "./ai-client";
import { logPersistence } from "./persistence-logger";

const PIECES_DIR = "pieces";

/** Lazy-loaded Tauri FS module. Null in browser. */
async function getTauriFs() {
  if (!isTauri()) return null;
  try {
    return await import("@tauri-apps/plugin-fs");
  } catch {
    return null;
  }
}

/** Ensure the fragments backup directory exists. */
async function ensurePiecesDir(): Promise<boolean> {
  const fs = await getTauriFs();
  if (!fs) return false;
  try {
    const exists = await fs.exists(PIECES_DIR, { baseDir: fs.BaseDirectory.AppLocalData });
    if (!exists) {
      await fs.mkdir(PIECES_DIR, { baseDir: fs.BaseDirectory.AppLocalData, recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

/** Save a single fragment to the file system. Best-effort, never throws. */
export async function backupPieceToFs(piece: ContentPiece): Promise<void> {
  if (!isTauri()) return;
  try {
    const dirReady = await ensurePiecesDir();
    if (!dirReady) return;

    const fs = await getTauriFs();
    if (!fs) return;

    const filePath = `${PIECES_DIR}/${piece.id}.json`;
    await fs.writeTextFile(filePath, JSON.stringify(piece), {
      baseDir: fs.BaseDirectory.AppLocalData,
    });

    logPersistence("fs_backup_save", { pieceId: piece.id, contentLength: piece.body.length });
  } catch (err) {
    logPersistence("fs_backup_fail", {
      op: "save",
      pieceId: piece.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Remove a fragment's file-system backup. Best-effort, never throws. */
export async function removePieceFromFs(pieceId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const fs = await getTauriFs();
    if (!fs) return;

    const filePath = `${PIECES_DIR}/${pieceId}.json`;
    const exists = await fs.exists(filePath, { baseDir: fs.BaseDirectory.AppLocalData });
    if (exists) {
      await fs.remove(filePath, { baseDir: fs.BaseDirectory.AppLocalData });
    }
  } catch {
    // best-effort
  }
}

/**
 * Load all fragments from the file-system backup.
 * The last-resort restore path, for a library whose IndexedDB is gone.
 */
export async function loadPiecesFromFs(): Promise<ContentPiece[]> {
  if (!isTauri()) return [];
  try {
    const fs = await getTauriFs();
    if (!fs) return [];

    const dirExists = await fs.exists(PIECES_DIR, { baseDir: fs.BaseDirectory.AppLocalData });
    if (!dirExists) return [];

    const entries = await fs.readDir(PIECES_DIR, { baseDir: fs.BaseDirectory.AppLocalData });
    const pieces: ContentPiece[] = [];

    for (const entry of entries) {
      if (!entry.name?.endsWith(".json")) continue;
      try {
        const content = await fs.readTextFile(`${PIECES_DIR}/${entry.name}`, {
          baseDir: fs.BaseDirectory.AppLocalData,
        });
        const piece = JSON.parse(content) as ContentPiece;
        pieces.push(piece);
      } catch {
        // corrupt file, skip
      }
    }

    pieces.sort((a, b) => b.updatedAt - a.updatedAt);

    logPersistence("fs_backup_load", { count: pieces.length });
    return pieces;
  } catch (err) {
    logPersistence("fs_backup_fail", {
      op: "load",
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
