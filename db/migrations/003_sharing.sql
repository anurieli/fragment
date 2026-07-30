-- Sharing a draft for comment.
--
-- Fragment already had a review loop: "Send for review" builds a standalone
-- HTML file (src/lib/review/build-review-file.ts), you email it, the reviewer
-- comments offline and mails a JSON file back. It works and it needs no
-- server. It also asks a favour of the reviewer every single time, and the
-- number of people who will download an attachment, open it, and email a
-- second file back is much smaller than the number who will click a link.
--
-- This schema is the hosted version of that same loop. The comment model is
-- deliberately unchanged (anchorText + prefix + suffix, resolved against the
-- live document by locateAnchor), so a comment made in a browser and a comment
-- made in an emailed file are the same shape and land in the same panel.
--
-- The rule that shapes everything below: a reviewer sees their own comments
-- and nobody else's. Only the owner sees all of them. That is not a UI
-- preference, it is the reason people are willing to be candid about a draft,
-- so it is enforced in the query layer (src/lib/server/shares.ts) rather than
-- left to the caller to remember.

-- ---------------------------------------------------------------------------
-- Shares
-- ---------------------------------------------------------------------------

-- One row per "I sent this draft out". Scoped to a note, owned by a user.
--
-- `snapshot_markdown` freezes the draft at the moment of sharing. Reviewers
-- must not watch the document move under them mid-sentence, and an anchor
-- captured against text that has since been rewritten is an anchor that will
-- not resolve. Re-sharing takes a fresh snapshot and bumps `revision`.
--
-- `token_hash` and not the token: the URL secret is stored only as its
-- SHA-256, exactly as sessions are (db/migrations/001_init.sql). Reading this
-- table therefore yields no working share links.
create table if not exists shares (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  note_id           text not null,
  token_hash        text unique not null,
  title             text not null,
  snapshot_markdown text not null,
  revision          integer not null default 1,
  -- Whether reviewers are allowed to edit the text, not just comment on it.
  allow_edits       boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Set to revoke the link without destroying the comments already collected.
  revoked_at        timestamptz,
  expires_at        timestamptz
);

create index if not exists shares_user_idx on shares(user_id, created_at desc);
create index if not exists shares_note_idx on shares(user_id, note_id);

-- ---------------------------------------------------------------------------
-- Guests
-- ---------------------------------------------------------------------------

-- A reviewer. Not a user: no account, no password, no row in `users`. An
-- email address and a per-share secret is the whole identity, because the
-- entire point of the feature is that a friend can help without signing up.
--
-- The email is NOT verified, and nothing here pretends otherwise. It labels a
-- column of comments so the owner knows who said what; it is not an
-- authentication factor and must never be treated as one. What actually gates
-- access is `token_hash`, which we mint and they never choose.
--
-- Which is exactly why there is NO unique constraint on (share_id, email) for
-- self-identified guests. The obvious schema puts one there so a reviewer who
-- clears their cookies resumes their own thread. It also means anyone holding
-- the link can type a colleague's address and be handed that colleague's
-- comments, which breaks the one promise the feature makes. An unverified
-- address cannot be allowed to resume a session.
--
-- So a guest is their token, and the address is a label printed next to it.
-- Two browsers, two rows, even for the same person. The owner sees the same
-- address twice, which is a cosmetic cost paid to keep a candid review
-- private. Invitations are the exception below: the owner chose those
-- addresses, so they are deduplicated.
create table if not exists share_guests (
  id            uuid primary key default gen_random_uuid(),
  share_id      uuid not null references shares(id) on delete cascade,
  email         text not null,
  name          text,
  token_hash    text unique not null,
  -- True when the owner sent this person an invite rather than them arriving
  -- through a forwarded link. Only affects what the owner is shown.
  invited       boolean not null default false,
  first_seen_at timestamptz,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists share_guests_share_idx on share_guests(share_id);

-- Invitations are deduplicated, self-identified guests are not. Re-inviting
-- an address the owner already invited reissues that person's link instead of
-- creating a second row; someone arriving through a forwarded link and typing
-- the same address gets their own row and cannot reach the invitee's comments.
create unique index if not exists share_guests_invited_email_idx
  on share_guests(share_id, email) where invited;

-- ---------------------------------------------------------------------------
-- Comments and suggested edits
-- ---------------------------------------------------------------------------

-- Mirrors ReviewComment in src/lib/types.ts one column per field. `anchor_text`
-- empty means a general note about the draft rather than one pinned to a
-- selection, which is how the standalone review page has always encoded it.
--
-- guest_id is the isolation boundary. Every read on behalf of a guest filters
-- on it; only an owner-scoped read omits it.
create table if not exists share_comments (
  id          uuid primary key default gen_random_uuid(),
  share_id    uuid not null references shares(id) on delete cascade,
  guest_id    uuid not null references share_guests(id) on delete cascade,
  client_id   text not null,
  anchor_text text not null default '',
  prefix      text not null default '',
  suffix      text not null default '',
  body        text not null,
  -- The snapshot revision this anchor was captured against, so a comment left
  -- on an older draft can be shown as possibly-stale rather than silently
  -- failing to highlight.
  revision    integer not null default 1,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  -- Resubmitting a review replaces that guest's set rather than duplicating it.
  unique (guest_id, client_id)
);

create index if not exists share_comments_share_idx on share_comments(share_id, created_at);
create index if not exists share_comments_guest_idx on share_comments(guest_id);

-- A reviewer's edited copy of the whole draft, when they turned editing on.
-- One row per guest per submission; history is kept rather than overwritten so
-- the owner can see how a reviewer's suggestion changed between passes.
create table if not exists share_edits (
  id               uuid primary key default gen_random_uuid(),
  share_id         uuid not null references shares(id) on delete cascade,
  guest_id         uuid not null references share_guests(id) on delete cascade,
  edited_full_text text not null,
  revision         integer not null default 1,
  created_at       timestamptz not null default now()
);

create index if not exists share_edits_share_idx on share_edits(share_id, created_at desc);
create index if not exists share_edits_guest_idx on share_edits(guest_id, created_at desc);
