-- Billing readiness. No billing code exists yet; this migration exists so
-- that when Stripe arrives, it plugs into a schema that was designed for it
-- rather than retrofitted around it.
--
-- The model (researched against how Cursor, Lovable, v0 and OpenRouter charge
-- for AI in 2026): the credit wallet lives HERE, in Postgres, as the source of
-- truth. Stripe only moves money. Stripe's own credit grants apply at invoice
-- time and cannot enforce a real-time balance, which is useless for stopping
-- an AI request that would overdraw. So: grants are buckets with an expiry and
-- a priority; the ledger is append-only fact; balance is derived, never
-- authored.

-- ---------------------------------------------------------------------------
-- Users learn about money
-- ---------------------------------------------------------------------------

-- stripe_customer_id stays null until first checkout: free users have no
-- business existing in Stripe. plan/plan_status mirror the subscription state
-- webhooks report; they are a cache of Stripe's truth, unlike credits, which
-- are OUR truth.
alter table users
  add column if not exists stripe_customer_id text unique,
  add column if not exists plan text not null default 'free',
  add column if not exists plan_status text;

-- ---------------------------------------------------------------------------
-- Credits
-- ---------------------------------------------------------------------------

-- A grant is a bucket of credit with a lifetime: the monthly allowance a plan
-- cycle deposits, a purchased top-up pack, a signup gift. Amounts are integer
-- micro-USD (1_000_000 = $1). Integers because money math in floats is how
-- balances drift; micro-USD because AI token costs are fractions of a cent.
create table if not exists credit_grants (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users(id) on delete cascade,
  initial_amount    bigint not null check (initial_amount >= 0),
  remaining_amount  bigint not null,
  source            text not null check (source in ('signup', 'plan_cycle', 'pack_purchase', 'promo', 'admin')),
  -- Lower is consumed first: promos before plan credits before paid packs,
  -- so the credits that expire soonest or cost the user nothing drain first.
  priority          int not null default 100,
  -- 'stripe' today, maybe 'paddle' or 'polar' tomorrow. The ledger must not
  -- marry the payment processor.
  external_provider text,
  external_ref      text,
  idempotency_key   text unique,
  effective_at      timestamptz not null default now(),
  expires_at        timestamptz,
  created_at        timestamptz not null default now()
);

-- The debit path's query: this user's live buckets, cheapest-to-burn first.
create index if not exists credit_grants_active_idx
  on credit_grants (user_id, priority, expires_at)
  where remaining_amount > 0;

-- Append-only. A row is a fact that happened: credit granted, usage debited,
-- a bucket expired, a refund reversed. Never UPDATE, never DELETE; the
-- balance is sum(delta) and disagreements re-derive from here.
create table if not exists credit_ledger (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references users(id) on delete cascade,
  grant_id        uuid references credit_grants(id),
  delta           bigint not null,
  entry_type      text not null check (entry_type in ('grant', 'debit', 'expiry', 'reversal', 'adjustment')),
  -- Ties a debit to the exact AI request that cost it.
  api_log_id      uuid references api_logs(id),
  -- Retries must not double-charge: debits key on the AI request id, grants
  -- key on the Stripe event or object id.
  idempotency_key text not null unique,
  created_at      timestamptz not null default now()
);

create index if not exists credit_ledger_user_idx on credit_ledger (user_id, created_at);

-- ---------------------------------------------------------------------------
-- Stripe webhook dedupe
-- ---------------------------------------------------------------------------

-- Stripe retries webhooks and may deliver them out of order. Insert the event
-- id first; a primary-key conflict means this event was already handled, and
-- the handler returns 200 without doing the work twice.
create table if not exists stripe_events (
  id           text primary key,
  type         text not null,
  payload      jsonb,
  processed_at timestamptz,
  received_at  timestamptz not null default now()
);
