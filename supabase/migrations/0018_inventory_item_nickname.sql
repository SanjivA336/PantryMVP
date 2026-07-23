-- Nicknames belong on the physical item (the jug/carton), not the
-- household-wide variant record: two jugs of the same Whole Milk food
-- definition can be labeled "HEB milk" and "Costco milk" independently
-- while still summing into the same total via their shared
-- global_food_definition_id. household_food_variants.name_override was
-- never actually settable from any UI (grep confirms only inventory_items.py
-- ever read it, nothing ever wrote it), so this is a clean move, not a
-- migration of real data.

alter table public.household_food_variants
  drop column name_override;

alter table public.inventory_items
  add column name_override text;

drop function if exists public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text
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
  v_share numeric;
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
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text, text
) from public, anon, authenticated;
grant execute on function public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text, text
) to service_role;
