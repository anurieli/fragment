-- Identity, made provider-agnostic.
--
-- `users.codex_sub` has been the literal identity key since 001_init.sql:
-- unique, not null, the column `signIn` upserts on conflict against. That
-- was fine when Codex sign-in was the only door in. It stops being fine the
-- day a second provider exists, because a `not null` column cannot hold "no
-- Codex identity, only a Google one" without either lying or being nullable
-- in a way that stops meaning "the identity."
--
-- Decided 2026-07-30 (Ariel, asked directly): Google is the front door.
-- ChatGPT/Codex is not an identity, only a way to connect AI. So this had to
-- move before Google sign-in could exist at all, not alongside it.
--
-- A user can now hold zero, one, or several identities. `users` keeps `email`
-- and `name` as a display cache (whichever identity last supplied them), not
-- as the source of truth; the source of truth is this table.

create table if not exists identities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  -- 'openai' for the existing Codex/ChatGPT sign-in; 'google' lands with
  -- ARI-229. Not an enum: a provider is added by shipping code that verifies
  -- its tokens, not by a migration, and a text column doesn't ask for both.
  provider    text not null,
  -- The provider's own subject claim. Verified upstream (see
  -- src/lib/server/codex-verify.ts) before this table is ever touched; this
  -- migration does not and cannot re-verify anything.
  subject     text not null,
  created_at  timestamptz not null default now(),
  unique (provider, subject)
);

create index if not exists identities_user_idx on identities(user_id);

-- Backfill: every existing Codex-identified user gets the identity row that
-- represents how they actually signed in, so nobody is signed out by this
-- migration.
insert into identities (user_id, provider, subject)
select id, 'openai', codex_sub from users
on conflict (provider, subject) do nothing;

-- The column this migration exists to retire. Nothing outside signIn() ever
-- read it (verified before writing this migration), so there is no second
-- call site to chase down.
alter table users drop column if exists codex_sub;
