"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, RefreshCw, X } from "lucide-react";

import type { ContentPiece } from "@/lib/content-engine";
import {
  createShare,
  listShares,
  refreshShare,
  revokeShare,
  shareUrl,
  invitedUrl,
  ShareError,
  type ShareSummary,
} from "@/lib/sharing/client";
import { shareKeyFor } from "@/lib/sharing/share-key";
import { useToastStore } from "@/hooks/use-toast";

interface ShareDialogProps {
  /** The fragment being shared. Links are keyed by `shareKeyFor(piece)`. */
  piece: Pick<ContentPiece, "id" | "legacyNoteId">;
  title: string;
  /** Read lazily, so the link always freezes what is on screen right now. */
  getMarkdown: () => string;
  onClose: () => void;
}

interface InvitedLink {
  email: string;
  url: string;
}

/**
 * "Send this to someone."
 *
 * Two ways out, and the difference matters. A plain link asks whoever opens
 * it who they are. A per-person link, produced by adding addresses below,
 * opens already knowing, so an invited reviewer types nothing at all.
 *
 * Fragment does not send the emails yet, so invitations come back as links to
 * paste rather than silently vanishing into a mail provider that is not
 * configured. When one is, this component keeps its shape and the links stop
 * being shown.
 */
export function ShareDialog({ piece, title, getMarkdown, onClose }: ShareDialogProps) {
  const showToast = useToastStore((s) => s.showToast);
  const shareKey = shareKeyFor(piece);

  const [existing, setExisting] = useState<ShareSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [invites, setInvites] = useState("");
  const [invited, setInvited] = useState<InvitedLink[]>([]);
  const [allowEdits, setAllowEdits] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = existing.filter((s) => !s.revokedAt);

  useEffect(() => {
    let cancelled = false;
    listShares(shareKey)
      .then((shares) => {
        if (!cancelled) setExisting(shares);
      })
      .catch(() => {
        // A signed-out or self-hosted build simply has no shares to list.
        if (!cancelled) setExisting([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shareKey]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = useCallback(
    async (value: string, key: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        setTimeout(() => setCopied((c) => (c === key ? null : c)), 1600);
      } catch {
        showToast("Couldn't copy — select the link and copy it manually");
      }
    },
    [showToast],
  );

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const emails = invites
        .split(/[\s,;]+/)
        .map((e) => e.trim())
        .filter(Boolean);

      const result = await createShare({
        shareKey,
        title,
        markdown: getMarkdown(),
        allowEdits,
        invite: emails,
      });

      setToken(result.token);
      setExisting((prev) => [result.share, ...prev]);
      setInvited(
        result.invited.map((i) => ({ email: i.email, url: invitedUrl(result.token, i.token) })),
      );
      setInvites("");
      await copy(shareUrl(result.token), "main");
      showToast("Link created and copied");
    } catch (err) {
      setError(err instanceof ShareError ? err.message : "Couldn't create the link");
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh(share: ShareSummary) {
    setBusy(true);
    try {
      const { revision } = await refreshShare(share.id, getMarkdown(), title);
      setExisting((prev) => prev.map((s) => (s.id === share.id ? { ...s, revision } : s)));
      showToast("Reviewers now see the current draft");
    } catch (err) {
      setError(err instanceof ShareError ? err.message : "Couldn't update the draft");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(share: ShareSummary) {
    setBusy(true);
    try {
      await revokeShare(share.id);
      setExisting((prev) =>
        prev.map((s) => (s.id === share.id ? { ...s, revokedAt: new Date().toISOString() } : s)),
      );
      showToast("Link turned off. Comments already left are kept.");
    } catch (err) {
      setError(err instanceof ShareError ? err.message : "Couldn't turn off the link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(12,12,11,0.7)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] max-h-[85vh] overflow-y-auto bg-surface border border-border-strong rounded-[var(--radius-lg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Share for comments"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <Link2 size={15} className="text-text-muted" />
            <h2 className="text-[13px] font-medium text-text-primary">Share for comments</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-4 flex flex-col gap-4">
          <p className="text-[12px] leading-relaxed text-text-muted">
            Anyone with the link can read this draft and leave comments. They only give an email
            address, no account. Reviewers never see each other&apos;s comments; you see all of them.
          </p>

          {error && (
            <p className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          {loading ? (
            <div className="flex items-center gap-2 text-[12px] text-text-muted py-2">
              <Loader2 size={13} className="animate-spin" />
              Checking for existing links...
            </div>
          ) : (
            <>
              {active.length > 0 && !token && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] uppercase tracking-wider text-text-muted">
                    Already shared
                  </p>
                  {active.map((share) => (
                    <div
                      key={share.id}
                      className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-border rounded text-[12px]"
                    >
                      <span className="flex-1 text-text-secondary truncate">
                        {share.title}
                        <span className="text-text-muted"> · draft {share.revision}</span>
                      </span>
                      <button
                        onClick={() => handleRefresh(share)}
                        disabled={busy}
                        className="p-1 text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
                        title="Show reviewers the current draft, keeping the same link"
                      >
                        <RefreshCw size={12} />
                      </button>
                      <button
                        onClick={() => handleRevoke(share)}
                        disabled={busy}
                        className="text-[11px] text-text-muted hover:text-red-400 transition-colors disabled:opacity-50"
                        title="Turn the link off. Comments already left are kept."
                      >
                        Turn off
                      </button>
                    </div>
                  ))}
                  <p className="text-[11px] text-text-muted">
                    The link above never changes. Creating another gives you a second, separate one.
                  </p>
                </div>
              )}

              {token ? (
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <input
                      readOnly
                      value={shareUrl(token)}
                      onFocus={(e) => e.currentTarget.select()}
                      className="flex-1 px-3 py-2 bg-surface-2 border border-border rounded text-[12px] text-text-secondary font-mono"
                    />
                    <button
                      onClick={() => copy(shareUrl(token), "main")}
                      className="px-3 py-2 bg-accent text-[12px] font-medium rounded hover:opacity-90 transition-opacity flex items-center gap-1.5"
                      style={{ color: "var(--color-bg)" }}
                    >
                      {copied === "main" ? <Check size={12} /> : <Copy size={12} />}
                      {copied === "main" ? "Copied" : "Copy"}
                    </button>
                  </div>

                  {invited.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <p className="text-[11px] uppercase tracking-wider text-text-muted">
                        Personal links
                      </p>
                      <p className="text-[11px] text-text-muted leading-relaxed">
                        Fragment can&apos;t send email yet, so send these yourself. Each one opens
                        already knowing who that person is, so they skip the email step.
                      </p>
                      {invited.map((inv) => (
                        <div
                          key={inv.email}
                          className="flex items-center gap-2 px-3 py-2 bg-surface-2 border border-border rounded"
                        >
                          <span className="flex-1 text-[12px] text-text-secondary truncate">
                            {inv.email}
                          </span>
                          <button
                            onClick={() => copy(inv.url, inv.email)}
                            className="text-[11px] text-text-muted hover:text-text-primary transition-colors flex items-center gap-1"
                          >
                            {copied === inv.email ? <Check size={11} /> : <Copy size={11} />}
                            {copied === inv.email ? "Copied" : "Copy link"}
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    onClick={onClose}
                    className="mt-1 px-4 py-2 border border-border rounded text-[12px] text-text-secondary hover:bg-surface-2 transition-colors"
                  >
                    Done
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="share-invites"
                      className="text-[11px] uppercase tracking-wider text-text-muted"
                    >
                      Invite by email <span className="normal-case tracking-normal">(optional)</span>
                    </label>
                    <textarea
                      id="share-invites"
                      value={invites}
                      onChange={(e) => setInvites(e.target.value)}
                      rows={2}
                      placeholder="alex@example.com, sam@example.com"
                      className="w-full px-3 py-2 bg-surface-2 border border-border rounded text-[12px] text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 text-[12px] text-text-secondary cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowEdits}
                      onChange={(e) => setAllowEdits(e.target.checked)}
                      className="accent-[var(--color-gold)]"
                    />
                    Let reviewers suggest edits, not just comments
                  </label>

                  <button
                    onClick={handleCreate}
                    disabled={busy}
                    className="px-4 py-2.5 bg-accent text-[12px] font-medium rounded hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ color: "var(--color-bg)" }}
                  >
                    {busy && <Loader2 size={13} className="animate-spin" />}
                    {busy ? "Creating..." : "Create link"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
