-- Fragment cloud, initial schema.
--
-- Two things live here that used to live nowhere: identity (who owns what) and
-- content (the writing itself). Until now every note, idea and piece existed
-- only in one browser's IndexedDB, which is why nothing could follow you to a
-- second device. This schema is the other half of that story.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

-- One row per person, keyed on the OIDC subject from Codex sign-in. `sub` is
-- stable across email changes, so it and not the address is the identity.
create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  codex_sub   text unique not null,
  email       text,
  name        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Server-side sessions rather than stateless JWTs, so that signing out of a
-- lost device actually revokes it. `id` is the SHA-256 of the cookie value:
-- a database leak therefore yields no usable session tokens.
create table if not exists sessions (
  id          text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  user_agent  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists sessions_user_idx    on sessions(user_id);
create index if not exists sessions_expires_idx on sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Synced content
-- ---------------------------------------------------------------------------

-- Every synced record from every Dexie collection lands in this one table.
--
-- The server deliberately does not model a note's or an idea's internals. Its
-- job is ownership, ordering and transport; the client owns the shape. Keeping
-- the body in `doc` means the Dexie schema can reach v19, v20, v30 without a
-- server migration behind every field, and it keeps one sync query rather than
-- one per collection. When a server-side feature genuinely needs to read into
-- the body (resource embeddings for search, say), that gets a generated column
-- and an index at the point of need instead of up front.
--
-- `rev` comes from a single global sequence. A client's cursor is the highest
-- rev it has seen, so pulling changes is `where user_id = $1 and rev > $2`
-- ordered by rev. `updated_at` is the client's wall clock in milliseconds and
-- exists for a different purpose: deciding which of two concurrent edits wins.
create sequence if not exists documents_rev_seq;

create table if not exists documents (
  user_id     uuid not null references users(id) on delete cascade,
  collection  text not null,
  id          text not null,
  doc         jsonb,
  updated_at  bigint not null,
  deleted     boolean not null default false,
  rev         bigint not null default nextval('documents_rev_seq'),
  primary key (user_id, collection, id)
);

-- The one query the sync endpoint runs on the pull side.
create index if not exists documents_user_rev_idx on documents(user_id, rev);

-- ---------------------------------------------------------------------------
-- Telemetry (formerly Convex)
-- ---------------------------------------------------------------------------

-- A device is not a user. It is how the app identifies an install before
-- anyone has signed in, which is why user_id is nullable and nulls out rather
-- than cascading: losing an account should not erase the usage record.
create table if not exists devices (
  id                      text primary key,
  user_id                 uuid references users(id) on delete set null,
  name                    text,
  email                   text,
  platform                text,
  app_version             text,
  writing_types           text[],
  role                    text,
  profile_source          text,
  onboarding_completed_at timestamptz,
  first_seen_at           timestamptz not null default now(),
  last_seen_at            timestamptz not null default now()
);

create index if not exists devices_user_idx on devices(user_id);

create table if not exists feedback (
  id                  uuid primary key default gen_random_uuid(),
  device_id           text,
  user_id             uuid references users(id) on delete set null,
  type                text not null check (type in ('bug', 'feature', 'feedback')),
  message             text not null,
  status              text not null default 'new',
  screenshot_key      text,
  screen_recording_key text,
  voice_note_key      text,
  platform            text,
  app_version         text,
  screen_resolution   text,
  user_agent          text,
  active_note_id      text,
  created_at          timestamptz not null default now()
);

create index if not exists feedback_status_idx  on feedback(status);
create index if not exists feedback_created_idx on feedback(created_at desc);

create table if not exists api_logs (
  id                uuid primary key default gen_random_uuid(),
  device_id         text,
  user_id           uuid references users(id) on delete set null,
  route             text not null,
  caller            text,
  provider          text,
  model             text,
  status            text,
  status_code       integer,
  error             text,
  duration_ms       integer,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  cost              double precision,
  prompt_length     integer,
  response_length   integer,
  client_timestamp  bigint,
  created_at        timestamptz not null default now()
);

create index if not exists api_logs_created_idx  on api_logs(created_at desc);
create index if not exists api_logs_provider_idx on api_logs(provider);
