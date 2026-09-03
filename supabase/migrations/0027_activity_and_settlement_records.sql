-- Activity feed + recorded settlements. Two new append-only tables, and the
-- retirement of a column that was only ever half-built.
--
-- 1. household_activity -- a household-wide log of notable events (an item
--    added / used / removed / moved, a cost correction, a recorded
--    settlement, a member joining or leaving). Written only by the FastAPI
--    service layer, never by a trigger: the API is already the single
--    authoritative mutation path in this codebase, it has the acting
--    member's identity (a trigger running under service_role does not --
--    auth.uid() is null there), and keeping activity-writing in one layer
--    keeps it unit-testable. Display strings (actor_nickname, subject_name)
--    are DENORMALIZED at write time on purpose: an activity log should read
--    the way it did when it happened, so renaming a member or an item
--    later must not silently rewrite history -- and the feed never needs a
--    join to render a row.
--
-- 2. settlement_records -- "payer paid payee $X", the record that actually
--    closes the settle-up loop. Append-only like every other financial
--    record in this schema (purchase_events, consumption_events,
--    ledger_entries, purchase_corrections): a mistaken settlement is undone
--    by appending a reversing row (parties swapped, reverses_settlement_id
--    set), never by an UPDATE or DELETE. compute_balances (Python) nets
--    these in as a third source alongside posted ledger_entries and
--    not-yet-frozen live shares.
--
-- 3. ledger_entries.settled_at -- drop it. It has been dead since it was
--    added (migration 0009): nothing ever wrote it, and "settling" by
--    stamping it on a batch of historical entries would mean mutating
--    immutable financial rows and inventing rules for which entries a
--    given payment covers. settlement_records replaces it cleanly.

-- =========================================================================
-- 1. household_activity
-- =========================================================================

create type activity_type as enum (
  'ITEM_ADDED',
  'ITEM_CONSUMED',
  'ITEM_REMOVED',
  'ITEM_MOVED',
  'COST_CORRECTED',
  'SETTLEMENT_RECORDED',
  'SETTLEMENT_REVERSED',
  'MEMBER_JOINED',
  'MEMBER_LEFT'
);

create table public.household_activity (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  type activity_type not null,
  -- Nullable: some rows have no actor worth showing (an item reaching zero
  -- is reported without one), and an actor's member row can be set null
  -- later if the underlying account is deleted.
  actor_member_id uuid references public.members (id) on delete set null,
  actor_nickname text,
  subject_name text,
  -- Type-specific extras: amount + unit, from/to location, previous/new
  -- cost, removal reason, payer/payee nicknames, ... Freeform jsonb so a
  -- new event type is a new enum value and nothing more.
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index household_activity_feed_idx
  on public.household_activity (household_id, created_at desc);
-- Backs the per-type filter the Activity page (and, later, notification
-- preferences) layers on top of the feed.
create index household_activity_type_idx
  on public.household_activity (household_id, type, created_at desc);

-- Append-only: block UPDATE outright, using the same reject_mutation
-- trigger (migration 0004) the other event logs use. No DELETE-blocking
-- trigger -- per the 0008 lesson, that would break the households ON
-- DELETE CASCADE; row deletion is already gated by "no RLS delete policy
-- exists, and no endpoint deletes a row individually".
create trigger household_activity_no_update
  before update on public.household_activity
  for each row execute function public.reject_mutation();

alter table public.household_activity enable row level security;

create policy household_activity_select on public.household_activity
  for select
  using (public.is_household_member(household_id));

-- Writes are service-role only (which bypasses RLS): the feed is derived
-- state the API appends to as a side effect of real operations, never
-- something a browser posts to directly.
revoke insert, update, delete on public.household_activity from authenticated, anon;

-- =========================================================================
-- 2. settlement_records
-- =========================================================================

create table public.settlement_records (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  payer_member_id uuid not null references public.members (id) on delete restrict,
  payee_member_id uuid not null references public.members (id) on delete restrict,
  -- Unconstrained scale, matching ledger_entries.amount -- rounding only
  -- ever happens at display time, never at rest.
  amount numeric not null check (amount > 0),
  note text,
  recorded_by_member_id uuid not null references public.members (id) on delete restrict,
  -- Set only on a reversal row: points at the settlement being undone. The
  -- reversal is itself an ordinary row with payer/payee swapped, so
  -- compute_balances nets every row by one uniform rule and a reversal
  -- simply cancels its original.
  reverses_settlement_id uuid references public.settlement_records (id) on delete restrict,
  created_at timestamptz not null default now(),
  check (payer_member_id <> payee_member_id)
);

create index settlement_records_household_idx
  on public.settlement_records (household_id, created_at desc);
create index settlement_records_reverses_idx
  on public.settlement_records (reverses_settlement_id)
  where reverses_settlement_id is not null;

create trigger settlement_records_no_update
  before update on public.settlement_records
  for each row execute function public.reject_mutation();

alter table public.settlement_records enable row level security;

create policy settlement_records_select on public.settlement_records
  for select
  using (public.is_household_member(household_id));

revoke insert, update, delete on public.settlement_records from authenticated, anon;

-- =========================================================================
-- 3. Retire ledger_entries.settled_at
-- =========================================================================

-- The two partial indexes are predicated on `settled_at is null`, so they
-- have to go before the column does.
drop index if exists public.ledger_entries_debtor_open_idx;
drop index if exists public.ledger_entries_creditor_open_idx;

alter table public.ledger_entries drop column settled_at;

-- Recreated without the (now impossible) "open only" predicate --
-- compute_balances still narrows by household + member, it just no longer
-- has a settled/unsettled split to filter on.
create index ledger_entries_debtor_idx
  on public.ledger_entries (household_id, debtor_member_id);
create index ledger_entries_creditor_idx
  on public.ledger_entries (household_id, creditor_member_id);

-- =========================================================================
-- 4. Realtime -- same mechanism as migrations 0011 / 0013. Each table's
--    RLS SELECT policy (is_household_member) is what Realtime evaluates
--    per connected user, so household isolation needs nothing extra here.
-- =========================================================================

alter publication supabase_realtime add table public.household_activity;
alter publication supabase_realtime add table public.settlement_records;
