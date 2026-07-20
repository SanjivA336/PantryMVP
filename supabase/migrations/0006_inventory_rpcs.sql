-- Phase 2a RPCs. Same rationale as create_household_and_join/
-- join_household_by_code in 0001: supabase-py's .table() calls are
-- independent PostgREST requests with no shared transaction, so any
-- "insert several related rows together" operation needs to run as one
-- Postgres function to stay atomic.

-- =========================================================================
-- create_manual_inventory_item
--
-- Creates a PurchaseEvent + gets-or-creates the household's variant of the
-- chosen global food definition + creates the InventoryItem + records who's
-- allowed to use it, all in one transaction.
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
  p_allowed_member_ids uuid[]
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
begin
  insert into public.purchase_events (household_id, member_id, total_cost, purchased_at)
    values (p_household_id, p_member_id, p_cost, now())
    returning id into v_purchase_event_id;

  -- Get-or-create the household's variant of this global definition.
  -- INSERT .. ON CONFLICT DO NOTHING .. RETURNING, falling back to SELECT
  -- on a no-op conflict, avoids the select-then-insert race window.
  insert into public.household_food_variants (household_id, global_food_definition_id)
    values (p_household_id, p_global_food_definition_id)
    on conflict (household_id, global_food_definition_id) do nothing
    returning id into v_variant_id;

  if v_variant_id is null then
    select id into v_variant_id
    from public.household_food_variants
    where household_id = p_household_id
      and global_food_definition_id = p_global_food_definition_id;
  end if;

  insert into public.inventory_items (
    household_id, household_food_variant_id, storage_location_id, purchase_event_id,
    quantity, total_quantity, preferred_unit, cost, purchased_at, expiry_date, best_by_date
  ) values (
    p_household_id, v_variant_id, p_storage_location_id, v_purchase_event_id,
    p_quantity, p_quantity, p_preferred_unit, p_cost, now(), p_expiry_date, p_best_by_date
  )
  returning * into v_item;

  insert into public.inventory_item_allowed_members (inventory_item_id, member_id)
    select v_item.id, unnest(p_allowed_member_ids);

  return v_item;
end;
$$;

revoke execute on function public.create_manual_inventory_item from public, anon, authenticated;
grant execute on function public.create_manual_inventory_item to service_role;

-- =========================================================================
-- consume_inventory_item
--
-- Atomically caps usage at the item's remaining physical quantity: the
-- UPDATE's WHERE clause (quantity >= p_quantity_used) makes this safe under
-- concurrent requests without explicit locking — Postgres serializes
-- concurrent UPDATEs to the same row, so only one racing request can
-- succeed once quantity would go negative.
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

  insert into public.consumption_events (household_id, member_id, inventory_item_id, quantity_used)
    values (p_household_id, p_member_id, p_inventory_item_id, p_quantity_used);

  return v_item;
end;
$$;

revoke execute on function public.consume_inventory_item from public, anon, authenticated;
grant execute on function public.consume_inventory_item to service_role;

-- =========================================================================
-- search_global_food_definitions
--
-- Trigram similarity match, ranked is_verified DESC, usage_count DESC per
-- the design doc (verification/popularity outrank raw text-similarity).
-- =========================================================================

create or replace function public.search_global_food_definitions(p_query text, p_limit integer default 10)
returns setof public.global_food_definitions
language sql
stable
as $$
  select *
  from public.global_food_definitions
  where duplicate_of_id is null
    and (name ilike '%' || p_query || '%' or name % p_query)
  order by is_verified desc, usage_count desc, similarity(name, p_query) desc
  limit p_limit;
$$;

revoke execute on function public.search_global_food_definitions from public, anon, authenticated;
grant execute on function public.search_global_food_definitions to service_role;
