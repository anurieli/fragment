/**
 * Node-only filesystem operations backing the agent-inbox HTTP routes.
 *
 * Deliberately separated from `import.ts` (pure, environment-agnostic) and
 * `paths.ts` (pure path math): this module is the only place that actually
 * touches disk on the server, so it's the one place callers need to review
 * for filesystem-safety. `resolveInboxRelPath` (paths.ts) is used for every
 * write here — nothing in this file trusts a client-supplied path without
 * running it through that guard first.
 */

import { mkdir, readdir, readFile, appendFile, rename, stat } from "node:fs/promises";
import path from "node:path";

import type { AgentInboxFile, AgentResourceFile } from "./import";
import { IMPORTED_DIR_NAME, STATUS_LOG_FILE_NAME, resolveInboxRelPath } from "./paths";

const SKIP_ENTRY_NAMES = new Set([IMPORTED_DIR_NAME, STATUS_LOG_FILE_NAME]);

/**
 * Recursively list every `.md` file under `inboxDir`, skipping the
 * `.imported/` archive and any dotfile/dot-directory (e.g. `.status.jsonl`).
 * Missing directory → empty list, not an error (steady state before any
 * agent has ever pushed a file).
 */
export async function listPendingHandoffFiles(
  inboxDir: string,
  sinceMs?: number,
): Promise<AgentInboxFile[]> {
  const resolvedRoot = path.resolve(inboxDir);
  const results: AgentInboxFile[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return; // directory doesn't exist (or isn't readable) — nothing pending
    }

    for (const entry of entries) {
      if (SKIP_ENTRY_NAMES.has(entry.name) || entry.name.startsWith(".")) continue;

      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

      try {
        const [content, fileStat] = await Promise.all([
          readFile(entryPath, "utf-8"),
          stat(entryPath),
        ]);
        const mtime = fileStat.mtimeMs;
        if (sinceMs !== undefined && mtime <= sinceMs) continue;

        results.push({
          fileName: entry.name,
          relPath: path.relative(resolvedRoot, entryPath).split(path.sep).join("/"),
          content,
          mtime,
        });
      } catch {
        // Unreadable / vanished mid-scan — skip, it'll be picked up next poll.
      }
    }
  }

  await walk(resolvedRoot);
  return results;
}

/**
 * List every `<ideaId>/resources.jsonl` file directly under `inboxDir` (one
 * level — resource files are never nested deeper than an idea directory,
 * unlike piece handoffs which `listPendingHandoffFiles` walks recursively).
 * An idea directory with no resources.jsonl (the common case) is silently
 * skipped, same "steady state is empty, not an error" posture as above.
 */
export async function listPendingResourceFiles(inboxDir: string): Promise<AgentResourceFile[]> {
  const resolvedRoot = path.resolve(inboxDir);
  let entries;
  try {
    entries = await readdir(resolvedRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: AgentResourceFile[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const filePath = path.join(resolvedRoot, entry.name, "resources.jsonl");
    try {
      const [content, fileStat] = await Promise.all([readFile(filePath, "utf-8"), stat(filePath)]);
      results.push({
        ideaId: entry.name,
        relPath: path.relative(resolvedRoot, filePath).split(path.sep).join("/"),
        content,
        mtime: fileStat.mtimeMs,
      });
    } catch {
      // no resources.jsonl for this idea, or unreadable mid-scan — skip
    }
  }
  return results;
}

export interface AckResult {
  relPath: string;
  ok: boolean;
  movedTo?: string;
  error?: string;
}

/**
 * Move an already-imported handoff file into `.imported/`, preserving its
 * filename and uniquifying on collision (`name.md` -> `name-2.md`, etc).
 * `relPath` MUST already have been validated with `resolveInboxRelPath` —
 * this function re-validates defensively but the caller owns rejecting bad
 * input with a proper error before calling.
 */
export async function ackImportedFile(inboxDir: string, relPath: string): Promise<AckResult> {
  const sourcePath = resolveInboxRelPath(inboxDir, relPath);
  if (!sourcePath) {
    return { relPath, ok: false, error: "invalid path" };
  }

  const resolvedRoot = path.resolve(inboxDir);
  const importedDir = path.join(resolvedRoot, IMPORTED_DIR_NAME);

  try {
    await mkdir(importedDir, { recursive: true });

    const fileName = path.basename(sourcePath);
    const ext = path.extname(fileName);
    const base = ext ? fileName.slice(0, -ext.length) : fileName;

    let targetPath = path.join(importedDir, fileName);
    let suffix = 2;
    // Uniquify on collision rather than overwrite — two files with the same
    // name pushed at different times should both survive in `.imported/`.
    while (await pathExists(targetPath)) {
      targetPath = path.join(importedDir, `${base}-${suffix}${ext}`);
      suffix += 1;
    }

    await rename(sourcePath, targetPath);
    return { relPath, ok: true, movedTo: path.relative(resolvedRoot, targetPath).split(path.sep).join("/") };
  } catch (error) {
    return { relPath, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface StatusEvent {
  pieceId: string;
  status: string;
  at: number;
}

/** Append status events to `.status.jsonl` as JSON lines, tagged `by: "user"`
 * (events acknowledged through this route always originate from the local
 * user's running app, never from the agent that pushed the piece). */
export async function appendStatusEvents(inboxDir: string, events: readonly StatusEvent[]): Promise<void> {
  if (events.length === 0) return;
  const resolvedRoot = path.resolve(inboxDir);
  await mkdir(resolvedRoot, { recursive: true });
  const statusPath = path.join(resolvedRoot, STATUS_LOG_FILE_NAME);
  const lines = events.map((event) => JSON.stringify({ ...event, by: "user" })).join("\n") + "\n";
  await appendFile(statusPath, lines, "utf-8");
}
