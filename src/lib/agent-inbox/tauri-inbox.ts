/**
 * Tauri desktop mode: read the agent inbox directly off disk via
 * @tauri-apps/plugin-fs instead of the HTTP route (which doesn't exist in
 * the static-export Tauri build — see src/lib/ai-client.ts's isTauri
 * detection and src/lib/fs-backup.ts for the established lazy-load pattern
 * this file follows).
 *
 * `~/.fragment/inbox` is addressed as `.fragment/inbox` relative to
 * BaseDirectory.Home so it matches the same directory CLI agents and the
 * HTTP ingress route use — desktop and self-hosted-server users share one
 * inbox location.
 */

import type { AgentInboxFile } from "./import";
import { isTauri } from "@/lib/ai-client";

const INBOX_REL_DIR = ".fragment/inbox";
const IMPORTED_DIR_NAME = ".imported";

type TauriFsModule = typeof import("@tauri-apps/plugin-fs");

/** Lazy-loaded Tauri FS module. Null in browser (same pattern as fs-backup.ts). */
async function getTauriFs(): Promise<TauriFsModule | null> {
  if (!isTauri()) return null;
  try {
    return await import("@tauri-apps/plugin-fs");
  } catch {
    return null;
  }
}

async function walk(fs: TauriFsModule, dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await fs.readDir(dir, { baseDir: fs.BaseDirectory.Home });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.name === IMPORTED_DIR_NAME || entry.name.startsWith(".")) continue;
    const entryPath = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      out.push(...(await walk(fs, entryPath)));
    } else if (entry.isFile && entry.name.endsWith(".md")) {
      out.push(entryPath);
    }
  }
  return out;
}

/** Read every pending handoff `.md` file from `~/.fragment/inbox`. Best-effort. */
export async function readTauriInboxFiles(): Promise<AgentInboxFile[]> {
  const fs = await getTauriFs();
  if (!fs) return [];

  try {
    const rootExists = await fs.exists(INBOX_REL_DIR, { baseDir: fs.BaseDirectory.Home });
    if (!rootExists) return [];
  } catch {
    return [];
  }

  const filePaths = await walk(fs, INBOX_REL_DIR);
  const files: AgentInboxFile[] = [];

  for (const filePath of filePaths) {
    try {
      const content = await fs.readTextFile(filePath, { baseDir: fs.BaseDirectory.Home });
      const info = await fs.stat(filePath, { baseDir: fs.BaseDirectory.Home });
      files.push({
        fileName: filePath.split("/").pop() ?? filePath,
        relPath: filePath.slice(INBOX_REL_DIR.length + 1),
        content,
        mtime: info.mtime ? info.mtime.getTime() : Date.now(),
      });
    } catch {
      // unreadable/vanished mid-scan — skip, picked up next poll
    }
  }
  return files;
}

/** Move acked handoff files into `.fragment/inbox/.imported/`, uniquifying on collision. */
export async function ackTauriImportedFiles(relPaths: readonly string[]): Promise<void> {
  if (relPaths.length === 0) return;
  const fs = await getTauriFs();
  if (!fs) return;

  const importedDir = `${INBOX_REL_DIR}/${IMPORTED_DIR_NAME}`;
  try {
    const dirExists = await fs.exists(importedDir, { baseDir: fs.BaseDirectory.Home });
    if (!dirExists) {
      await fs.mkdir(importedDir, { baseDir: fs.BaseDirectory.Home, recursive: true });
    }
  } catch {
    return; // can't create the archive dir — leave files in place, retry next poll
  }

  for (const relPath of relPaths) {
    // relPaths here are only ever ones this module itself produced via
    // readTauriInboxFiles' walk (never client-supplied), but guard against
    // traversal anyway since defense-in-depth is cheap.
    if (relPath.split("/").some((segment) => segment === "..")) continue;

    const fromPath = `${INBOX_REL_DIR}/${relPath}`;
    const fileName = relPath.split("/").pop() ?? relPath;
    const dot = fileName.lastIndexOf(".");
    const base = dot >= 0 ? fileName.slice(0, dot) : fileName;
    const ext = dot >= 0 ? fileName.slice(dot) : "";

    let toPath = `${importedDir}/${fileName}`;
    try {
      let suffix = 2;
      while (await fs.exists(toPath, { baseDir: fs.BaseDirectory.Home })) {
        toPath = `${importedDir}/${base}-${suffix}${ext}`;
        suffix += 1;
      }
      await fs.rename(fromPath, toPath, {
        oldPathBaseDir: fs.BaseDirectory.Home,
        newPathBaseDir: fs.BaseDirectory.Home,
      });
    } catch {
      // best-effort — file stays in the inbox, retried next poll
    }
  }
}
