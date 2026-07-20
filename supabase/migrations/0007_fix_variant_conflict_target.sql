-- Same class of bug as 0002: household_food_variants_unique_global is a
-- partial unique index (where global_food_definition_id is not null), so
-- Postgres can't infer it as the ON CONFLICT arbiter without repeating that
-- predicate in the clause — otherwise 42P10 "no unique or exclusion
-- constraint matching the ON CONFLICT specification".

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
