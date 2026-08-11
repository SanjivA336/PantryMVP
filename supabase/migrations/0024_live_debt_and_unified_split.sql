-- Live-until-frozen debt tracking + one unified allotment/overage split rule.
--
-- Today, non-PERSONAL items are billed immediately and permanently at
-- purchase time (an equal-split PURCHASE ledger entry), with UNIT_BASED
-- additionally posting incremental, permanent OVERAGE entries as usage
-- crosses each member's allotment. Because that's immediate and the ledger
-- is immutable, there's no clean way to fix a mistake, and the incremental
-- overage math is order-dependent (an early "slack refund" to someone who
-- later also goes over doesn't get revisited).
--
-- New model: an item's debt isn't real (isn't in ledger_entries) until the
-- item's story is over (EMPTY/DISCARDED/EXPIRED/LOST). While active, each
-- member's share is computed live from current usage (see
-- services/accounting.py's compute_item_shares) and shown to the user
-- exactly as if it were real, but nothing is posted -- so cost, quantity,
-- and the allowed-members roster can just be edited directly. The moment an
-- item leaves ACTIVE, its final share is computed once and posted for real.
-- inventory_items.debt_frozen_at is the single signal for which regime an
-- item is in: null = still live/editable, non-null = final/correction-only.
--
-- This also collapses accounting_type from
-- (PERSONAL, SHARED_CONSUMABLE, UNIT_BASED) to (PERSONAL, SHARED) -- the new
-- allotment-cascade rule replaces both non-personal modes with one rule that
-- degrades to "split evenly" when nobody goes over and to "usage-based" when
-- someone does, so there's no longer a mode to choose between at purchase
-- time.

-- =========================================================================
-- 1. Drop the one function whose signature is typed against the old enum
--    (create_manual_inventory_item takes p_accounting_type accounting_type)
--    -- must go before the type itself can be dropped below.
-- =========================================================================

drop function if exists public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text, text
);

-- The old roster-edit policies read accounting_type in their USING/WITH
-- CHECK clauses, which blocks altering that column's type below -- drop
-- them here, recreate the (widened) versions once the swap is done.
drop policy inventory_item_allowed_members_insert on public.inventory_item_allowed_members;
drop policy inventory_item_allowed_members_delete on public.inventory_item_allowed_members;

-- =========================================================================
-- 2. Swap the enum: three columns reference it
--    (inventory_items.accounting_type, receipt_import_items.accounting_type,
--    global_food_definitions.accounting_type_default). SHARED_CONSUMABLE and
--    UNIT_BASED both collapse to SHARED; PERSONAL is untouched.
-- =========================================================================

create type accounting_type_new as enum ('PERSONAL', 'SHARED');

alter table public.inventory_items drop constraint inventory_items_split_count_check;

alter table public.inventory_items
  alter column accounting_type type accounting_type_new
  using (
    case when accounting_type::text = 'PERSONAL' then 'PERSONAL' else 'SHARED' end
  )::accounting_type_new;

alter table public.receipt_import_items
  alter column accounting_type type accounting_type_new
  using (
    case
      when accounting_type is null then null
      when accounting_type::text = 'PERSONAL' then 'PERSONAL'
      else 'SHARED'
    end
  )::accounting_type_new;

alter table public.global_food_definitions
  alter column accounting_type_default drop default;
alter table public.global_food_definitions
  alter column accounting_type_default type accounting_type_new
  using (
    case when accounting_type_default::text = 'PERSONAL' then 'PERSONAL' else 'SHARED' end
  )::accounting_type_new;
alter table public.global_food_definitions
  alter column accounting_type_default set default 'SHARED';

drop type accounting_type;
alter type accounting_type_new rename to accounting_type;

alter table public.inventory_items add constraint inventory_items_split_count_check check (
  (accounting_type = 'PERSONAL' and split_member_count is null)
  or (accounting_type <> 'PERSONAL' and split_member_count is not null and split_member_count > 0)
);

-- =========================================================================
-- 3. create_manual_inventory_item, recreated against the renamed type --
--    same signature, minus the immediate PURCHASE billing block. Creating
--    an item no longer bills anyone; that happens once, at freeze.
-- =========================================================================

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
  p_accounting_type accounting_type,
  p_receipt_image_path text default null,
  p_name_override text default null
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
begin
  v_member_count := coalesce(array_length(p_allowed_member_ids, 1), 0);
  if v_member_count = 0 then
    raise exception 'ITEM_MUST_HAVE_ALLOWED_MEMBERS';
  end if;

  insert into public.purchase_events (
    household_id, member_id, total_cost, purchased_at, receipt_image_url
  )
    values (p_household_id, p_member_id, p_cost, now(), p_receipt_image_path)
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
    accounting_type, split_member_count, name_override
  ) values (
    p_household_id, v_variant_id, p_storage_location_id, v_purchase_event_id,
    p_quantity, p_quantity, p_preferred_unit, p_cost, now(), p_expiry_date, p_best_by_date,
    p_accounting_type, case when p_accounting_type = 'PERSONAL' then null else v_member_count end,
    p_name_override
  )
  returning * into v_item;

  insert into public.inventory_item_allowed_members (inventory_item_id, member_id)
    select v_item.id, unnest(p_allowed_member_ids);

  return v_item;
end;
$$;

revoke execute on function public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text, text
) from public, anon, authenticated;
grant execute on function public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text, text
) to service_role;

-- =========================================================================
-- 4. consume_inventory_item, same signature -- minus the UNIT_BASED
--    incremental overage-billing block. Still does the atomic
--    quantity-decrement + allowed-member check + consumption_events insert;
--    freeze_item_debt (Python, services/accounting.py) now owns all billing,
--    computed once when an item leaves ACTIVE.
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

  insert into public.consumption_events (household_id, member_id, inventory_item_id, quantity_used)
    values (p_household_id, p_member_id, p_inventory_item_id, p_quantity_used);

  return v_item;
end;
$$;

-- =========================================================================
-- 5. debt_frozen_at -- the live/final signal. Backfilled for every existing
--    non-PERSONAL item (active or not): their already-posted PURCHASE/
--    OVERAGE ledger entries, billed under the old rules, are grandfathered
--    in untouched and excluded from the new live-balance computation. Only
--    items created after this migration go through the live-until-frozen
--    lifecycle.
-- =========================================================================

alter table public.inventory_items add column debt_frozen_at timestamptz;

update public.inventory_items
  set debt_frozen_at = now()
  where accounting_type <> 'PERSONAL';

-- =========================================================================
-- 6. purchase_corrections -- append-only, like every other financial record
--    in this schema. Only ever posted for already-frozen items (see
--    services/accounting.py's correction endpoint); a correction can touch
--    cost, quantity, or both (nullable pairs distinguish "untouched").
-- =========================================================================

create table public.purchase_corrections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  corrected_by_member_id uuid not null references public.members (id) on delete restrict,
  previous_cost numeric(10, 2),
  new_cost numeric(10, 2) check (new_cost is null or new_cost >= 0),
  previous_total_quantity numeric(10, 3),
  new_total_quantity numeric(10, 3) check (new_total_quantity is null or new_total_quantity > 0),
  note text,
  created_at timestamptz not null default now(),
  check (new_cost is not null or new_total_quantity is not null)
);

create index purchase_corrections_inventory_item_id_idx
  on public.purchase_corrections (inventory_item_id);

alter table public.purchase_corrections enable row level security;

create policy purchase_corrections_select on public.purchase_corrections
  for select
  using (public.is_household_member(household_id));
create policy purchase_corrections_insert on public.purchase_corrections
  for insert
  with check (public.is_household_member(household_id));
-- No update/delete policy -- immutable, same as ledger_entries/purchase_events.

-- =========================================================================
-- 7. Roster edits: previously locked to PERSONAL items only, now also
--    allowed for any item whose debt hasn't frozen yet (matches this
--    comment's own original intent -- "the math silently drifts" concern
--    only applies once real ledger rows exist). Policies were dropped up
--    front (step 1) since they blocked the accounting_type column swap.
-- =========================================================================

create policy inventory_item_allowed_members_insert on public.inventory_item_allowed_members
  for insert
  with check (
    exists (
      select 1 from public.inventory_items i
      where i.id = inventory_item_id
        and public.is_household_member(i.household_id)
        and (i.accounting_type = 'PERSONAL' or i.debt_frozen_at is null)
    )
  );
create policy inventory_item_allowed_members_delete on public.inventory_item_allowed_members
  for delete
  using (
    exists (
      select 1 from public.inventory_items i
      where i.id = inventory_item_id
        and public.is_household_member(i.household_id)
        and (i.accounting_type = 'PERSONAL' or i.debt_frozen_at is null)
    )
  );
