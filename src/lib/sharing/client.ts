import type { ReviewComment } from "@/lib/types";

/**
 * The browser's view of sharing a draft.
 *
 * Thin on purpose: every rule that matters (who owns what, who may read whose
 * comments) is enforced server-side in src/lib/server/shares.ts. Nothing here
 * is a security boundary, and none of it should grow into one.
 */

export interface ShareSummary {
  id: string;
  noteId: string;
  title: string;
  revision: number;
  allowEdits: boolean;
  createdAt: string;
  revokedAt?: string | null;
  expiresAt?: string | null;
  /** Cheap aggregate — how many comments this share has and when the newest
   * one landed, so the toolbar's "new comments" badge (ARI-245) never has to
   * fetch full review bodies just to know whether to light up. */
  commentCount?: number;
  lastCommentAt?: string | null;
}

export interface HostedReview {
  guestId: string;
  email: string;
  name: string | null;
  invited: boolean;
  lastSeenAt: string | null;
  comments: Array<ReviewComment & { createdAt: string; revision: number }>;
  editedFullText: string | null;
  editedAt: string | null;
}

export class ShareError extends Error {}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ShareError(body.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** The reviewer-facing URL for a share token. */
export function shareUrl(token: string, origin = window.location.origin): string {
  return `${origin}/r/${token}`;
}

/** A per-person link that skips the "who's reading?" step. */
export function invitedUrl(token: string, guestToken: string, origin = window.location.origin): string {
  return `${origin}/r/${token}/enter?k=${encodeURIComponent(guestToken)}`;
}

export async function createShare(input: {
  noteId: string;
  title: string;
  markdown: string;
  allowEdits?: boolean;
  invite?: string[];
}): Promise<{ share: ShareSummary; token: string; invited: Array<{ email: string; token: string }> }> {
  return json(
    await fetch("/api/v1/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(input),
    }),
  );
}

export async function listShares(noteId?: string): Promise<ShareSummary[]> {
  const url = noteId ? `/api/v1/shares?noteId=${encodeURIComponent(noteId)}` : "/api/v1/shares";
  const { shares } = await json<{ shares: ShareSummary[] }>(
    await fetch(url, { credentials: "same-origin" }),
  );
  return shares;
}

export async function listReviews(shareId: string): Promise<HostedReview[]> {
  const { reviews } = await json<{ reviews: HostedReview[] }>(
    await fetch(`/api/v1/shares/${shareId}/reviews`, { credentials: "same-origin" }),
  );
  return reviews;
}

export async function revokeShare(shareId: string): Promise<void> {
  await json(
    await fetch(`/api/v1/shares/${shareId}`, { method: "DELETE", credentials: "same-origin" }),
  );
}

/** Push the current draft to reviewers without changing the link. */
export async function refreshShare(
  shareId: string,
  markdown: string,
  title: string,
): Promise<{ revision: number }> {
  const { share } = await json<{ share: { revision: number } }>(
    await fetch(`/api/v1/shares/${shareId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ markdown, title }),
    }),
  );
  return { revision: share.revision };
}
