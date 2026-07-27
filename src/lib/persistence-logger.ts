/**
 * Persistence audit logger.
 *
 * Logs every note load, save, delete, and recovery event with counts and sizes.
 * Stored as a rotating buffer in localStorage so it survives IndexedDB failures.
 * Viewable via `localStorage.getItem("fragment:persistence:log")` in DevTools.
 */

const LOG_KEY = "fragment:persistence:log";
const MAX_ENTRIES = 200;

export type PersistenceEvent =
  | "hydrate_start"
  | "hydrate_complete"
  | "hydrate_fail"
  | "note_save"
  | "note_save_fail"
  | "note_delete"
  | "note_recovery"
  | "voice_hydrate_fail"
  | "voice_save_fail"
  | "idea_save_fail"
  | "piece_save_fail"
  | "resource_save_fail"
  /** An agent-inbox batch was imported but a write failed, so the handoff
   * files were deliberately left un-acked for the next poll to retry. */
  | "inbox_ack_withheld"
  | "review_save_fail"
  | "storage_persist_result"
  | "fs_backup_save"
  | "fs_backup_load"
  | "fs_backup_fail";

interface LogEntry {
  ts: string;
  event: PersistenceEvent;
  detail: Record<string, unknown>;
}

function getLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as LogEntry[];
  } catch {
    return [];
  }
}

function writeLog(entries: LogEntry[]): void {
  try {
    // Keep only the most recent entries
    const trimmed = entries.slice(-MAX_ENTRIES);
    localStorage.setItem(LOG_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full or unavailable — nothing we can do
  }
}

export function logPersistence(
  event: PersistenceEvent,
  detail: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    event,
    detail,
  };

  const entries = getLog();
  entries.push(entry);
  writeLog(entries);
}

/** Summarize current note state for audit logging. */
export function summarizeNotes(
  notes: Array<{ id: string; title: string; content: string; updatedAt: number }>,
): Record<string, unknown> {
  return {
    count: notes.length,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title.slice(0, 50) || "(untitled)",
      contentLength: n.content.length,
      updatedAt: new Date(n.updatedAt).toISOString(),
    })),
  };
}
