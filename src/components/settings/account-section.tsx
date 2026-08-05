"use client";

import { useRef, useState } from "react";
import { Check, Cloud, Download, HardDrive, Loader2, LogIn, LogOut, Monitor, RefreshCw, Upload } from "lucide-react";
import { isTauri } from "@/lib/ai-client";
import { useCloudSession } from "@/hooks/use-cloud-session";
import { useSyncStore } from "@/stores/sync-store";
import { useToastStore } from "@/hooks/use-toast";
import { createLibraryBackup, downloadLibraryBackup, parseLibraryBackup, restoreLibraryBackup } from "@/lib/library-backup";

export function AccountSection() {
  const session = useCloudSession();
  const sync = useSyncStore((state) => state.snapshot);
  const showToast = useToastStore((state) => state.showToast);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"export" | "import" | "sync" | null>(null);

  async function exportLibrary() {
    setBusy("export");
    try {
      downloadLibraryBackup(await createLibraryBackup());
      showToast("Library backup downloaded");
    } catch {
      showToast("Could not export your library");
    } finally {
      setBusy(null);
    }
  }

  async function importLibrary(file: File | undefined) {
    if (!file) return;
    setBusy("import");
    try {
      const count = await restoreLibraryBackup(parseLibraryBackup(await file.text()));
      showToast(`Imported ${count} library records. Reloading…`);
      window.setTimeout(() => window.location.reload(), 500);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not import that backup");
      setBusy(null);
    }
  }

  async function runSync() {
    setBusy("sync");
    try {
      await session.sync();
      showToast("Sync finished");
    } finally {
      setBusy(null);
    }
  }

  const signedInUser = session.status === "signed-in" ? session.user : null;
  const platform = isTauri() ? "Desktop app" : "Browser";

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl text-text-primary">Account & Sync</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-text-faint">
            Fragment always saves to this device first. Sign in to keep a cloud copy in sync across your browsers and computers.
          </p>
        </div>

        <section className="space-y-4 rounded-[var(--radius-lg)] border border-border-strong bg-surface-2 p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-3 text-text-muted"><Monitor size={15} /></div>
            <div>
              <p className="text-sm font-medium text-text-primary">{platform}</p>
              <p className="text-[10px] text-text-faint">Local IndexedDB is the offline working copy on this device.</p>
            </div>
          </div>

          {signedInUser ? (
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green/10 text-green"><Check size={15} /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text-primary">{signedInUser.name || signedInUser.email || "Fragment account"}</p>
                <p className="truncate text-[10px] text-text-faint">{signedInUser.email} · cloud sync {sync.status}</p>
              </div>
              <button onClick={() => void runSync()} disabled={busy !== null} className="flex items-center gap-1.5 text-[11px] text-gold disabled:opacity-50">
                {busy === "sync" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sync now
              </button>
              <button onClick={() => void session.signOut()} className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-secondary">
                <LogOut size={12} /> Sign out
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 border-t border-border pt-4">
              <Cloud size={16} className="text-text-faint" />
              <div className="flex-1">
                <p className="text-sm text-text-secondary">Local only</p>
                <p className="text-[10px] text-text-faint">Your work is not connected to a cloud account yet.</p>
              </div>
              <button onClick={session.signIn} disabled={session.status === "loading"} className="flex items-center gap-1.5 rounded-[var(--radius-sm)] bg-gold/15 px-3 py-2 text-[11px] font-medium text-gold disabled:opacity-50">
                {session.status === "loading" ? <Loader2 size={12} className="animate-spin" /> : <LogIn size={12} />} Sign in with Google
              </button>
            </div>
          )}

          {sync.error && <p className="text-[10px] text-red">{sync.error}</p>}
          {sync.pending > 0 && <p className="text-[10px] text-text-faint">{sync.pending} local changes waiting to sync.</p>}
        </section>

        <section className="space-y-4 rounded-[var(--radius-lg)] border border-border-strong bg-surface-2 p-5">
          <div className="flex items-start gap-3">
            <HardDrive size={17} className="mt-0.5 text-text-muted" />
            <div>
              <h3 className="text-sm font-medium text-text-primary">Move or back up your whole library</h3>
              <p className="mt-1 text-[10px] leading-relaxed text-text-faint">
                Includes articles, ideas, pieces, snippets, history, reviews, settings, Brand Voices, and voice samples. AI and publishing credentials are never included.
              </p>
            </div>
          </div>
          <div className="flex gap-2 pl-7">
            <button onClick={() => void exportLibrary()} disabled={busy !== null} className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-strong px-3 py-2 text-[11px] text-text-secondary disabled:opacity-50">
              {busy === "export" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Export library
            </button>
            <button onClick={() => inputRef.current?.click()} disabled={busy !== null} className="flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-border-strong px-3 py-2 text-[11px] text-text-secondary disabled:opacity-50">
              {busy === "import" ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} Import library
            </button>
            <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importLibrary(event.target.files?.[0])} />
          </div>
        </section>
      </div>
    </div>
  );
}
