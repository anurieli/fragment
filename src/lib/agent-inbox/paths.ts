/**
 * Path helpers for the agent-inbox routes. Pure string/path manipulation —
 * no filesystem I/O — so path-traversal defenses can be unit tested without
 * touching disk.
 */

import path from "node:path";

/**
 * Resolve a client-supplied relative path against the inbox directory,
 * refusing to leave it. Used by the ack route so a malicious/buggy
 * `relPath` can never resolve to a file outside `~/.fragment/inbox` (or
 * whatever FRAGMENT_INBOX_DIR points at).
 *
 * Returns the resolved absolute path, or `null` when the input is an
 * absolute path, contains a `..` traversal segment, or otherwise resolves
 * outside `inboxDir`.
 */
export function resolveInboxRelPath(inboxDir: string, relPath: string): string | null {
  if (typeof relPath !== "string" || relPath.length === 0) return null;
  if (path.isAbsolute(relPath)) return null;
  // Reject any traversal segment up front — path.normalize alone isn't
  // enough because a resolved path could coincidentally still land inside
  // inboxDir (e.g. a sibling directory that happens to share a prefix); we
  // want to reject the *shape* of the input, not just the outcome.
  const segments = relPath.split(/[\\/]+/);
  if (segments.some((segment) => segment === "..")) return null;

  const resolvedInboxDir = path.resolve(inboxDir);
  const resolved = path.resolve(resolvedInboxDir, relPath);

  if (resolved !== resolvedInboxDir && !resolved.startsWith(resolvedInboxDir + path.sep)) {
    return null;
  }
  return resolved;
}

/** Default inbox directory: `~/.fragment/inbox`, overridable for tests/ops. */
export function getInboxDir(env: { homeDir: string; inboxDirOverride?: string }): string {
  if (env.inboxDirOverride) return path.resolve(env.inboxDirOverride);
  return path.join(env.homeDir, ".fragment", "inbox");
}

export const IMPORTED_DIR_NAME = ".imported";
export const STATUS_LOG_FILE_NAME = ".status.jsonl";
