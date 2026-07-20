-- Phase 2b: the ledger settlement engine. This is the highest-risk part of
-- the whole project — read the comments, they encode real design decisions
-- (some of which correct genuine contradictions in the original design doc),
-- not just mechanics.

-- =========================================================================
-- inventory_items: accounting_type + a frozen roster-size snapshot
-- =========================================================================

create type ledger_entry_reason as enum ('PURCHASE', 'OVERAGE', 'ADJUSTMENT');

alter table public.inventory_items
  add column accounting_type accounting_type not null,
  add column split_member_count integer;

-- split_member_count is a SNAPSHOT of the allowed-member count at purchase
-- time, not something re-derived live from inventory_item_allowed_members.
-- The roster itself is frozen for non-PERSONAL items below (see the RLS
-- policy changes) specifically so this snapshot can never silently drift
-- from what was actually charged.
alter table public.inventory_items add constraint inventory_items_split_count_check check (
  (accounting_type = 'PERSONAL' and split_member_count is null)
  or (accounting_type <> 'PERSONAL' and split_member_count is not null and split_member_count > 0)
);

-- =========================================================================
-- ledger_entries
-- =========================================================================

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  creditor_member_id uuid not null references public.members (id) on delete restrict,
  debtor_member_id uuid not null references public.members (id) on delete restrict,
  -- Deliberately unconstrained scale (not numeric(x,2)) — constraining scale
  -- would mean rounding at write time, which the resolved design explicitly
  -- forbids. Debts are exact; rounding only ever happens at display/settle
  -- time, outside this table.
  amount numeric not null check (amount > 0),
  reason ledger_entry_reason not null,
  source_purchase_event_id uuid references public.purchase_events (id) on delete restrict,
  source_consumption_event_id uuid references public.consumption_events (id) on delete restrict,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  check (creditor_member_id <> debtor_member_id),
  -- Two nullable FKs rather than a polymorphic (type, id) pair — keeps real
  -- referential integrity, matching how the rest of this schema is built.
  check (
    (reason = 'PURCHASE' and source_purchase_event_id is not null and source_consumption_event_id is null)
    or (reason = 'OVERAGE' and source_consumption_event_id is not null and source_purchase_event_id is null)
    or (reason = 'ADJUSTMENT' and source_purchase_event_id is null and source_consumption_event_id is null)
  )
);

create index ledger_entries_household_id_idx on public.ledger_entries (household_id);
create index ledger_entries_debtor_open_idx
  on public.ledger_entries (household_id, debtor_member_id) where settled_at is null;
create index ledger_entries_creditor_open_idx
  on public.ledger_entries (household_id, creditor_member_id) where settled_at is null;
create index ledger_entries_source_purchase_idx on public.ledger_entries (source_purchase_event_id);
create index ledger_entries_source_consumption_idx on public.ledger_entries (source_consumption_event_id);

-- Backs the per-member cumulative-usage lookups the settlement RPC does.
create index consumption_events_item_member_idx on public.consumption_events (inventory_item_id, member_id);

-- =========================================================================
-- RLS: ledger_entries — no insert/update/delete policy for authenticated/
-- anon at all. FastAPI's own writes go through the service-role client
-- (which bypasses RLS unconditionally) via exactly two RPCs below — RLS
-- here protects against a browser talking to PostgREST directly, it does
-- NOT protect against a stray write from FastAPI's own code. That half of
-- "single writer" is enforced by code discipline: only the two RPCs below
-- ever touch this table.
-- =========================================================================

alter table public.ledger_entries enable row level security;

create policy ledger_entries_select on public.ledger_entries
  for select
  using (public.is_household_member(household_id));

revoke insert, update, delete on public.ledger_entries from authenticated, anon;

create trigger ledger_entries_no_update
  before update on public.ledger_entries
  for each row execute function public.reject_mutation();
-- No delete-blocking trigger — per the 0008 lesson, deletion stays possible
-- only via the household's cascade (ledger_entries.household_id references
-- households on delete cascade), gated by "no RLS delete policy exists, no
-- endpoint deletes a row individually."

-- =========================================================================
-- Freeze inventory_item_allowed_members for cost-tracked items.
--
-- 2a left this table freely editable by any member at any time (fine when
-- it was purely informational). 2b's allotment/overage math is defined in
-- terms of "the roster at purchase time" — if the roster can change after
-- the fact, the math silently drifts from what was actually charged. PERSON-
-- AL items never touch the ledger, so they keep free roster editing.
-- =========================================================================

drop policy inventory_item_allowed_members_insert on public.inventory_item_allowed_members;
drop policy inventory_item_allowed_members_delete on public.inventory_item_allowed_members;

create policy inventory_item_allowed_members_insert on public.inventory_item_allowed_members
  for insert
  with check (
    exists (
      select 1 from public.inventory_items i
      where i.id = inventory_item_id
        and public.is_household_member(i.household_id)
        and i.accounting_type = 'PERSONAL'
    )
  );
create policy inventory_item_allowed_members_delete on public.inventory_item_allowed_members
  for delete
  using (
    exists (
      select 1 from public.inventory_items i
      where i.id = inventory_item_id
        and public.is_household_member(i.household_id)
        and i.accounting_type = 'PERSONAL'
    )
  );
-- Note: this doesn't block the RPCs' own initial insert into this table —
-- they run under the function owner's privileges (SECURITY DEFINER) and
-- bypass RLS entirely, same as every other RPC in this schema.

-- =========================================================================
-- create_manual_inventory_item: add accounting_type + the initial PURCHASE
-- split.
--
-- Adding a parameter changes the function's signature/identity in Postgres
-- — CREATE OR REPLACE with a different parameter list creates a new
-- overload alongside the old one rather than replacing it. Drop the old
-- 10-parameter signature explicitly first, or it lingers as dead, stale code.
-- =========================================================================

drop function if exists public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[]
);

create or replace function public.create_manual_inventory_item(
  p_household_id uuid,
  p_member_id uuid,
  p_global_food_definition_id uuid,
  p_storage_location_id uuid,
  p_quantity numeric,
  p_preferred_unit text,
  p_cost numeric,
  p_expiry_date date,
  p_best_by_date date,
  p_allowed_member_ids uuid[],
  p_accounting_type accounting_type
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_event_id uuid;
  v_variant_id uuid;
  v_item public.inventory_items;
  v_member_count integer;
  v_share numeric;
begin
  v_member_count := coalesce(array_length(p_allowed_member_ids, 1), 0);
  if v_member_count = 0 then
    raise exception 'ITEM_MUST_HAVE_ALLOWED_MEMBERS';
  end if;

  insert into public.purchase_events (household_id, member_id, total_cost, purchased_at)
    values (p_household_id, p_member_id, p_cost, now())
    returning id into v_purchase_event_id;

  insert into public.household_food_variants (household_id, global_food_definition_id)
    values (p_household_id, p_global_food_definition_id)
    on conflict (household_id, global_food_definition_id) where global_food_definition_id is not null
    do nothing
    returning id into v_variant_id;

  if v_variant_id is null then
    select id into v_variant_id
    from public.household_food_variants
    where household_id = p_household_id
      and global_food_definition_id = p_global_food_definition_id;
  end if;

  insert into public.inventory_items (
    household_id, household_food_variant_id, storage_location_id, purchase_event_id,
    quantity, total_quantity, preferred_unit, cost, purchased_at, expiry_date, best_by_date,
    accounting_type, split_member_count
  ) values (
    p_household_id, v_variant_id, p_storage_location_id, v_purchase_event_id,
    p_quantity, p_quantity, p_preferred_unit, p_cost, now(), p_expiry_date, p_best_by_date,
    p_accounting_type, case when p_accounting_type = 'PERSONAL' then null else v_member_count end
  )
  returning * into v_item;

  insert into public.inventory_item_allowed_members (inventory_item_id, member_id)
    select v_item.id, unnest(p_allowed_member_ids);

  -- Initial cost split: everyone on the roster except the buyer owes their
  -- equal share. The buyer never gets a "self" entry — they already hold
  -- their own share by construction (nobody bills them for it).
  if p_accounting_type <> 'PERSONAL' and p_cost > 0 then
    v_share := p_cost / v_member_count;
    insert into public.ledger_entries
      (household_id, creditor_member_id, debtor_member_id, amount, reason, source_purchase_event_id)
    select p_household_id, p_member_id, distinct_member, v_share, 'PURCHASE', v_purchase_event_id
    from (select distinct unnest(p_allowed_member_ids) as distinct_member) d
    where distinct_member <> p_member_id;
  end if;

  return v_item;
end;
$$;

revoke execute on function public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type
) from public, anon, authenticated;
grant execute on function public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type
) to service_role;

-- =========================================================================
-- consume_inventory_item: enforce allowed_member_ids (2a left this
-- unenforced — harmless when only physical quantity was at stake, not
-- harmless now that consuming generates real debt), plus incremental
-- overage settlement for UNIT_BASED items.
--
-- INVARIANT: the UPDATE below must stay the FIRST statement in this
-- function. It acquires a row-level lock on the inventory_items row, held
-- for the rest of the transaction. Every downstream overage/slack read
-- relies on inheriting that lock — a second concurrent call for the SAME
-- item blocks on its own UPDATE until this transaction fully commits, which
-- means by the time it proceeds, all of this transaction's consumption_events
-- and ledger_entries writes are already visible to it. This is what makes
-- the overage math race-safe without any additional explicit locking.
-- =========================================================================

create or replace function public.consume_inventory_item(
  p_household_id uuid,
  p_member_id uuid,
  p_inventory_item_id uuid,
  p_quantity_used numeric
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_prior_used numeric;
  v_new_cumulative numeric;
  v_new_overage_qty numeric;
  v_allotment numeric;
  v_price_per_unit numeric;
  v_overage_cost numeric;
  v_total_slack numeric;
  v_new_event_id uuid;
begin
  update public.inventory_items
    set quantity = quantity - p_quantity_used
    where id = p_inventory_item_id
      and household_id = p_household_id
      and status = 'ACTIVE'
      and quantity >= p_quantity_used
    returning * into v_item;

  if v_item.id is null then
    raise exception 'INSUFFICIENT_QUANTITY';
  end if;

  if not exists (
    select 1 from public.inventory_item_allowed_members
    where inventory_item_id = p_inventory_item_id and member_id = p_member_id
  ) then
    raise exception 'MEMBER_NOT_ALLOWED';
  end if;

  select coalesce(sum(quantity_used), 0) into v_prior_used
  from public.consumption_events
  where inventory_item_id = p_inventory_item_id and member_id = p_member_id;

  insert into public.consumption_events (household_id, member_id, inventory_item_id, quantity_used)
    values (p_household_id, p_member_id, p_inventory_item_id, p_quantity_used)
    returning id into v_new_event_id;

  if v_item.accounting_type = 'UNIT_BASED' and v_item.cost > 0 then
    v_allotment := v_item.total_quantity / v_item.split_member_count;
    v_price_per_unit := v_item.cost / v_item.total_quantity;
    v_new_cumulative := v_prior_used + p_quantity_used;
    -- Delta-of-clamped-excess: correctly handles "stayed within allotment"
    -- (0), "crossed the allotment boundary mid-event" (only the excess past
    -- the line), and "already over before this event" (the full new amount)
    -- in one formula.
    v_new_overage_qty := greatest(v_new_cumulative - v_allotment, 0) - greatest(v_prior_used - v_allotment, 0);

    if v_new_overage_qty > 0 then
      v_overage_cost := v_new_overage_qty * v_price_per_unit;

      with slack as (
        select am.member_id,
               greatest(v_allotment - coalesce((
                 select sum(ce.quantity_used) from public.consumption_events ce
                 where ce.inventory_item_id = p_inventory_item_id and ce.member_id = am.member_id
               ), 0), 0) as slack_qty
        from public.inventory_item_allowed_members am
        where am.inventory_item_id = p_inventory_item_id
          and am.member_id <> p_member_id
      )
      select coalesce(sum(slack_qty), 0) into v_total_slack from slack;

      -- v_total_slack = 0 here should be unreachable: the physical-scarcity
      -- guard in the UPDATE above already ensures total overage can never
      -- exceed total slack across the item's lifetime. Left as a silent
      -- no-op rather than raising, defensively, rather than failing a
      -- consume request over a bookkeeping edge case.
      if v_total_slack > 0 then
        -- Over-consumer pays each slack-holding member directly, proportional
        -- to their share of slack. The buyer is NOT involved here — they
        -- already received their money via the initial PURCHASE split and
        -- have no further role in overage settlement. (This corrects a
        -- contradiction in the original design doc, where the worked
        -- example's prose said the over-consumer pays the slack members
        -- directly, but the accompanying pseudocode showed the buyer
        -- paying instead — resolved in favor of the prose.)
        insert into public.ledger_entries
          (household_id, creditor_member_id, debtor_member_id, amount, reason, source_consumption_event_id)
        select p_household_id, s.member_id, p_member_id,
               v_overage_cost * s.slack_qty / v_total_slack,
               'OVERAGE', v_new_event_id
        from slack s
        where s.slack_qty > 0;
      end if;
    end if;
  end if;

  return v_item;
end;
$$;
