"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Download, Loader2, RotateCcw } from "lucide-react";
import type { MigrationRecord } from "@/lib/types";
import { captureSnapshot, downloadSnapshot } from "@/lib/migration/snapshot";

/** Enough detail for a support conversation without turning the screen into a log. */
const MAX_SHOWN_FAILURES = 5;

interface MigrationFailedProps {
  record?: MigrationRecord;
  onRetry: () => void;
}

function formatStartedAt(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

/**
 * Blocking screen for a migration that refused to finish.
 *
 * The migration is additive and rolls itself back when the verification gate
 * says no, so the library on disk is untouched. What is broken is only the
 * app's ability to render the new UI against the old shape, which is why this
 * refuses to hand control back rather than showing a half-empty library.
 *
 * The reassurance is deliberately the second thing on the screen: the first
 * thing a writer thinks when an update fails is that the writing is gone.
 */
export function MigrationFailed({ record, onRetry }: MigrationFailedProps) {
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  async function downloadBackup() {
    setBackingUp(true);
    setBackupError(null);
    try {
      const snapshot = await captureSnapshot();
      if (!snapshot) {
        setBackupError("There is no Fragment library on this device to back up.");
        return;
      }
      downloadSnapshot(snapshot);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : "Could not write the backup file.");
    } finally {
      setBackingUp(false);
    }
  }

  const failures = record?.failures ?? [];
  const shown = failures.slice(0, MAX_SHOWN_FAILURES);
  const hidden = failures.length - shown.length;
  const hasDetails = failures.length > 0 || record !== undefined;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-bg px-8">
      <div className="w-[min(520px,100%)] space-y-5">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-1 shrink-0 text-gold" />
          <h1 className="font-[family-name:var(--font-display)] text-2xl text-text-primary">
            Fragment could not finish this update
          </h1>
        </div>

        <p className="text-[13px] leading-relaxed text-text-secondary">
          Nothing was changed and nothing was lost. Every idea, draft, and snip on this device is
          exactly as it was before the update started. Fragment stopped instead of continuing,
          because a half-finished update is the only way your writing could come to harm.
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void downloadBackup()}
            disabled={backingUp}
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-gold/15 px-3 py-2 text-[11px] font-medium text-gold disabled:opacity-50"
          >
            {backingUp ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            Download a backup of everything
          </button>
          <button
            type="button"
            onClick={onRetry}
            disabled={backingUp}
            className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-strong px-3 py-2 text-[11px] text-text-secondary disabled:opacity-50"
          >
            <RotateCcw size={12} />
            Try again
          </button>
        </div>

        {backupError && (
          <p className="rounded-[var(--radius-sm)] bg-red-muted px-3 py-2 text-[11px] leading-relaxed text-red">
            {backupError}
          </p>
        )}

        {hasDetails && (
          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-text-faint transition-colors duration-150 hover:text-text-secondary"
            >
              {detailsOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Technical details
            </button>

            {detailsOpen && (
              <div className="mt-3 space-y-2 rounded-[var(--radius-default)] border border-border bg-surface-2 p-3">
                {record && (
                  <p className="font-[family-name:var(--font-mono)] text-[10px] text-text-faint">
                    Started {formatStartedAt(record.startedAt)}
                  </p>
                )}
                {shown.map((failure, index) => (
                  <div
                    key={`${failure.code}-${failure.subject}-${index}`}
                    className="font-[family-name:var(--font-mono)] text-[10px] leading-relaxed break-words text-text-muted"
                  >
                    <span className="text-text-secondary">{failure.code}</span> {failure.subject}
                    <span className="block text-text-faint">{failure.detail}</span>
                  </div>
                ))}
                {hidden > 0 && (
                  <p className="font-[family-name:var(--font-mono)] text-[10px] text-text-faint">
                    and {hidden} more
                  </p>
                )}
                {failures.length === 0 && (
                  <p className="font-[family-name:var(--font-mono)] text-[10px] text-text-faint">
                    No specific failures were recorded.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
