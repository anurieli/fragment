import { createHash, randomBytes } from "node:crypto";

import { query, queryOne, transaction, isDatabaseConfigured } from "./db";

/**
 * Share-a-draft-for-comment: the data layer.
 *
 * Two kinds of caller reach this module and they are not equally trusted:
 *
 *   - the OWNER, holding a real session, who may see everything about their
 *     own share and nothing about anyone else's;
 *   - a GUEST, holding only a link, who may add comments and read back the
 *     ones they themselves wrote.
 *
 * A guest must never see another guest's comments. That is the feature, not a
 * nicety: people say what they actually think about a draft precisely because
 * the other reviewers are not watching. So the isolation is enforced here, in
 * the only code that builds these queries, rather than in each route. Every
 * guest-facing read below filters on `guest_id`, and the only function that
 * omits that filter (`listReviewsForOwner`) takes a `userId` and joins through
 * `shares.user_id`, so it cannot be called without proving ownership.
 *
 * Tokens follow the session convention (src/lib/server/session.ts): the caller
 * holds a 256-bit random value, the database stores only its SHA-256. Reading
 * these tables gives an attacker no working links.
 */

const SHARE_TTL_DAYS = 90;

/**
 * The cookie that remembers which reviewer this browser is, on one share.
 *
 * Namespaced by share id rather than a single `fragment_guest` cookie,
 * because reviewing a second draft must not evict your identity on the first.
 * One person reviewing three of someone's drafts holds three of these.
 */
export function guestCookieName(shareId: string): string {
  return `fg_${shareId.replace(/-/g, "")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Addresses are compared, so they are normalized once, on the way in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// A deliberately permissive check. This address is a label on a column of
// comments, not a credential, and the cost of wrongly rejecting a real
// reviewer's unusual address is much higher than the cost of storing a
// malformed one.
export function looksLikeEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length >= 3 && trimmed.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShareRow {
  id: string;
  userId: string;
  noteId: string;
  title: string;
  snapshotMarkdown: string;
  revision: number;
  allowEdits: boolean;
  createdAt: string;
  revokedAt: string | null;
  expiresAt: string | null;
}

export interface GuestRow {
  id: string;
  shareId: string;
  email: string;
  name: string | null;
  invited: boolean;
}

export interface CommentInput {
  id: string;
  anchorText: string;
  prefix: string;
  suffix: string;
  body: string;
}

export interface StoredComment extends CommentInput {
  createdAt: string;
  revision: number;
}

/** One reviewer's whole contribution, as the owner sees it. */
export interface OwnerReview {
  guestId: string;
  email: string;
  name: string | null;
  invited: boolean;
  lastSeenAt: string | null;
  comments: StoredComment[];
  editedFullText: string | null;
  editedAt: string | null;
}

interface ShareDbRow {
  id: string;
  user_id: string;
  note_id: string;
  title: string;
  snapshot_markdown: string;
  revision: number;
  allow_edits: boolean;
  created_at: string;
  revoked_at: string | null;
  expires_at: string | null;
}

function toShare(row: ShareDbRow): ShareRow {
  return {
    id: row.id,
    userId: row.user_id,
    noteId: row.note_id,
    title: row.title,
    snapshotMarkdown: row.snapshot_markdown,
    revision: row.revision,
    allowEdits: row.allow_edits,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
  };
}

const SHARE_COLUMNS = `id, user_id, note_id, title, snapshot_markdown, revision,
                       allow_edits, created_at, revoked_at, expires_at`;

// ─── Owner side ─────────────────────────────────────────────────────────────

export interface CreateShareInput {
  userId: string;
  noteId: string;
  title: string;
  markdown: string;
  allowEdits?: boolean;
}

/**
 * Mint a share link. Returns the plaintext token exactly once; it is not
 * recoverable afterwards, because only its hash is stored.
 */
export async function createShare(
  input: CreateShareInput,
): Promise<{ share: ShareRow; token: string }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const row = await queryOne<ShareDbRow>(
    `insert into shares (user_id, note_id, token_hash, title, snapshot_markdown, allow_edits, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning ${SHARE_COLUMNS}`,
    [
      input.userId,
      input.noteId,
      hashToken(token),
      input.title.trim() || "Untitled",
      input.markdown,
      input.allowEdits ?? true,
      expiresAt,
    ],
  );

  if (!row) throw new Error("Failed to create share");
  return { share: toShare(row), token };
}

/**
 * Refresh the frozen copy reviewers see, and bump the revision so comments
 * anchored against the older text can be flagged rather than silently lost.
 */
export async function resnapshotShare(
  shareId: string,
  userId: string,
  markdown: string,
  title: string,
): Promise<ShareRow | null> {
  const row = await queryOne<ShareDbRow>(
    `update shares
        set snapshot_markdown = $3,
            title             = $4,
            revision          = revision + 1,
            updated_at        = now()
      where id = $1 and user_id = $2
      returning ${SHARE_COLUMNS}`,
    [shareId, userId, markdown, title.trim() || "Untitled"],
  );
  return row ? toShare(row) : null;
}

export async function listSharesForUser(userId: string, noteId?: string): Promise<ShareRow[]> {
  const rows = noteId
    ? await query<ShareDbRow>(
        `select ${SHARE_COLUMNS} from shares
          where user_id = $1 and note_id = $2
          order by created_at desc`,
        [userId, noteId],
      )
    : await query<ShareDbRow>(
        `select ${SHARE_COLUMNS} from shares where user_id = $1 order by created_at desc`,
        [userId],
      );
  return rows.map(toShare);
}

/** Kill the link. Comments already collected survive; the door closes. */
export async function revokeShare(shareId: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `update shares set revoked_at = now(), updated_at = now()
      where id = $1 and user_id = $2 and revoked_at is null
      returning id`,
    [shareId, userId],
  );
  return rows.length > 0;
}

/**
 * Pre-register invited reviewers so their emailed link opens already knowing
 * who they are. Returns one token per address; the caller emails them.
 *
 * Re-inviting an address returns a fresh token for the existing guest rather
 * than creating a second identity, so a resent invitation still lands the
 * reviewer back on their own comments.
 */
export async function inviteGuests(
  shareId: string,
  userId: string,
  emails: string[],
): Promise<Array<{ email: string; token: string }>> {
  const owned = await queryOne<{ id: string }>(
    "select id from shares where id = $1 and user_id = $2",
    [shareId, userId],
  );
  if (!owned) return [];

  const unique = [...new Set(emails.map(normalizeEmail).filter(looksLikeEmail))];

  return transaction(async (client) => {
    const issued: Array<{ email: string; token: string }> = [];
    for (const email of unique) {
      const token = newToken();
      await client.query(
        `insert into share_guests (share_id, email, token_hash, invited)
         values ($1, $2, $3, true)
         on conflict (share_id, email) where invited do update
           set token_hash = excluded.token_hash`,
        [shareId, email, hashToken(token)],
      );
      issued.push({ email, token });
    }
    return issued;
  });
}

/**
 * Everything every reviewer said. Owner-only by construction: the share is
 * looked up by (id, user_id), so a caller who does not own it gets nothing
 * rather than someone else's feedback.
 */
export async function listReviewsForOwner(
  shareId: string,
  userId: string,
): Promise<OwnerReview[] | null> {
  const share = await queryOne<{ id: string }>(
    "select id from shares where id = $1 and user_id = $2",
    [shareId, userId],
  );
  if (!share) return null;

  const guests = await query<{
    id: string;
    email: string;
    name: string | null;
    invited: boolean;
    last_seen_at: string | null;
  }>(
    `select id, email, name, invited, last_seen_at
       from share_guests where share_id = $1 order by created_at`,
    [shareId],
  );

  const comments = await query<{
    guest_id: string;
    client_id: string;
    anchor_text: string;
    prefix: string;
    suffix: string;
    body: string;
    revision: number;
    created_at: string;
  }>(
    `select guest_id, client_id, anchor_text, prefix, suffix, body, revision, created_at
       from share_comments where share_id = $1 order by created_at`,
    [shareId],
  );

  // Latest suggested edit per guest. Earlier passes stay in the table; the
  // owner is shown the current one.
  const edits = await query<{ guest_id: string; edited_full_text: string; created_at: string }>(
    `select distinct on (guest_id) guest_id, edited_full_text, created_at
       from share_edits where share_id = $1
      order by guest_id, created_at desc`,
    [shareId],
  );

  const editByGuest = new Map(edits.map((e) => [e.guest_id, e]));

  return guests.map((g) => {
    const edit = editByGuest.get(g.id);
    return {
      guestId: g.id,
      email: g.email,
      name: g.name,
      invited: g.invited,
      lastSeenAt: g.last_seen_at,
      comments: comments
        .filter((c) => c.guest_id === g.id)
        .map((c) => ({
          id: c.client_id,
          anchorText: c.anchor_text,
          prefix: c.prefix,
          suffix: c.suffix,
          body: c.body,
          revision: c.revision,
          createdAt: c.created_at,
        })),
      editedFullText: edit?.edited_full_text ?? null,
      editedAt: edit?.created_at ?? null,
    };
  });
}

// ─── Guest side ─────────────────────────────────────────────────────────────

/** Resolve a share link. Revoked and expired links resolve to nothing. */
export async function findShareByToken(token: string): Promise<ShareRow | null> {
  if (!isDatabaseConfigured() || !token) return null;
  const row = await queryOne<ShareDbRow>(
    `select ${SHARE_COLUMNS} from shares
      where token_hash = $1
        and revoked_at is null
        and (expires_at is null or expires_at > now())`,
    [hashToken(token)],
  );
  return row ? toShare(row) : null;
}

/**
 * Register a reviewer who typed their address into the link, and hand back a
 * secret that stands in for it from then on.
 *
 * Always inserts. Never resumes an existing row by matching the address, and
 * that restraint is the whole security of the feature: the address is
 * unverified, so treating it as a lookup key would let anyone holding the
 * link type a colleague's address and be handed the colleague's comments.
 *
 * The price is that the same person on a second browser appears as a second
 * reviewer with the same address. That is a cosmetic problem for the owner's
 * sidebar. The alternative is a confidentiality bug, so the cosmetic problem
 * wins. Reviewers who should keep one identity across devices are the ones
 * the owner invited by email, and they carry a token to prove it.
 */
export async function identifyGuest(
  shareId: string,
  email: string,
  name?: string,
): Promise<{ guest: GuestRow; token: string }> {
  const token = newToken();
  const normalized = normalizeEmail(email);

  const row = await queryOne<{
    id: string;
    share_id: string;
    email: string;
    name: string | null;
    invited: boolean;
  }>(
    `insert into share_guests (share_id, email, name, token_hash, first_seen_at, last_seen_at)
     values ($1, $2, $3, $4, now(), now())
     returning id, share_id, email, name, invited`,
    [shareId, normalized, name?.trim() || null, hashToken(token)],
  );

  if (!row) throw new Error("Failed to identify guest");
  return {
    guest: { id: row.id, shareId: row.share_id, email: row.email, name: row.name, invited: row.invited },
    token,
  };
}

/**
 * The guest behind a token, but only if they belong to this share.
 *
 * The `share_id = $2` clause is load-bearing. Without it a token minted for
 * one draft would authenticate its holder on every other draft they were ever
 * sent, and worse, a stale cookie could attach one reviewer's comments to a
 * share they were never invited to.
 */
export async function findGuestByToken(token: string, shareId: string): Promise<GuestRow | null> {
  if (!token) return null;
  const row = await queryOne<{
    id: string;
    share_id: string;
    email: string;
    name: string | null;
    invited: boolean;
  }>(
    `update share_guests set last_seen_at = now(),
            first_seen_at = coalesce(first_seen_at, now())
      where token_hash = $1 and share_id = $2
      returning id, share_id, email, name, invited`,
    [hashToken(token), shareId],
  );
  if (!row) return null;
  return { id: row.id, shareId: row.share_id, email: row.email, name: row.name, invited: row.invited };
}

// ─── Input sanitising ───────────────────────────────────────────────────────

export const MAX_COMMENTS = 500;
export const MAX_COMMENT_BODY = 10_000;
const MAX_ANCHOR = 5_000;
const MAX_CONTEXT = 200;
const MAX_CLIENT_ID = 128;

function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/**
 * Coerce whatever the review page posted into comments we are willing to
 * store.
 *
 * The page is a public endpoint, so this treats its output as untrusted even
 * though we wrote it. Anything without an id or a non-empty body is dropped:
 * a comment with no body is not a comment, and storing it only gives the
 * owner a blank card to scroll past. Every field is truncated rather than
 * rejected, because a reviewer who pasted three pages into one comment should
 * lose the tail, not the whole review.
 */
export function sanitizeComments(raw: unknown): CommentInput[] {
  if (!Array.isArray(raw)) return [];
  const out: CommentInput[] = [];
  for (const item of raw.slice(0, MAX_COMMENTS)) {
    const record = item as Record<string, unknown> | null;
    const id = str(record?.id, MAX_CLIENT_ID);
    const body = str(record?.body, MAX_COMMENT_BODY).trim();
    if (!id || !body) continue;
    out.push({
      id,
      body,
      anchorText: str(record?.anchorText, MAX_ANCHOR),
      prefix: str(record?.prefix, MAX_CONTEXT),
      suffix: str(record?.suffix, MAX_CONTEXT),
    });
  }
  return out;
}

export interface SubmitReviewInput {
  shareId: string;
  guestId: string;
  revision: number;
  name?: string;
  comments: CommentInput[];
  editedFullText?: string;
}

/**
 * Record a reviewer's pass over the draft.
 *
 * Submitting is idempotent per comment: the standalone page keeps its comments
 * in localStorage and someone who hits "Send" twice, or comes back tomorrow
 * and adds one more, resends the whole set. Upserting on (guest_id, client_id)
 * means that produces one copy of each, not two.
 *
 * Comments the guest deleted locally are removed here too, so their set on the
 * server matches what they believe they submitted. The delete is scoped to
 * this guest, so it can never reach another reviewer's rows.
 */
export async function submitReview(input: SubmitReviewInput): Promise<{ saved: number }> {
  const { shareId, guestId, revision, comments, editedFullText } = input;

  return transaction(async (client) => {
    if (input.name?.trim()) {
      await client.query("update share_guests set name = $2 where id = $1", [
        guestId,
        input.name.trim(),
      ]);
    }

    const keepIds = comments.map((c) => c.id);
    if (keepIds.length > 0) {
      await client.query(
        "delete from share_comments where guest_id = $1 and not (client_id = any($2::text[]))",
        [guestId, keepIds],
      );
    } else {
      await client.query("delete from share_comments where guest_id = $1", [guestId]);
    }

    for (const c of comments) {
      await client.query(
        `insert into share_comments
           (share_id, guest_id, client_id, anchor_text, prefix, suffix, body, revision)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (guest_id, client_id) do update
           set anchor_text = excluded.anchor_text,
               prefix      = excluded.prefix,
               suffix      = excluded.suffix,
               body        = excluded.body,
               revision    = excluded.revision`,
        [shareId, guestId, c.id, c.anchorText, c.prefix, c.suffix, c.body, revision],
      );
    }

    if (editedFullText && editedFullText.trim()) {
      await client.query(
        `insert into share_edits (share_id, guest_id, edited_full_text, revision)
         values ($1, $2, $3, $4)`,
        [shareId, guestId, editedFullText, revision],
      );
    }

    return { saved: comments.length };
  });
}

/**
 * A guest reading back their own work. Filtered on `guest_id` and nothing
 * else is reachable from here: there is no variant of this function that
 * returns another reviewer's comments.
 */
export async function listCommentsForGuest(guestId: string): Promise<StoredComment[]> {
  const rows = await query<{
    client_id: string;
    anchor_text: string;
    prefix: string;
    suffix: string;
    body: string;
    revision: number;
    created_at: string;
  }>(
    `select client_id, anchor_text, prefix, suffix, body, revision, created_at
       from share_comments where guest_id = $1 order by created_at`,
    [guestId],
  );

  return rows.map((r) => ({
    id: r.client_id,
    anchorText: r.anchor_text,
    prefix: r.prefix,
    suffix: r.suffix,
    body: r.body,
    revision: r.revision,
    createdAt: r.created_at,
  }));
}
