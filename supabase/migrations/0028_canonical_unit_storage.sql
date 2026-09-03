-- Store every quantity in a canonical base unit; keep the user's chosen
-- unit purely as a display preference.
--
-- Until now, inventory_items.quantity / total_quantity and
-- recipe_ingredients.quantity were denominated in whatever unit the row's
-- `preferred_unit` / `unit` column said -- so that unit column wasn't a
-- display hint, it was load-bearing: lose it and a bare "2" is
-- meaningless (2 g? 2 gal?). And the metric<->customary toggle
-- (services/inventory_items.py update_item) *rewrites* the stored quantity
-- through a multiply-then-divide every time it's flipped, so repeated
-- toggles accumulate rounding error in real data.
--
-- New model: quantities are always persisted in the dimension's base unit
-- -- grams (WEIGHT), millilitres (VOLUME), plain count (COUNT). The unit
-- column is renamed `display_unit` and does nothing but decide how the
-- number is shown. The service layer converts base<->display at every read
-- and write boundary (services/units.py to_base / from_base /
-- display_quantity); the RPCs below just store whatever number Python
-- hands them, which is now always a base value. The API still presents
-- quantities in the user's unit, so the frontend is unchanged -- what
-- changes is that a lost/corrupted display_unit is now cosmetic, the unit
-- toggle is a no-op on the stored number, and same-dimension math is a
-- plain add.
--
-- Not touched: global_food_definitions.preferred_unit (already just a
-- catalog display/default hint, never attached to a stored quantity);
-- receipt_import_items (pre-finalize draft rows the user edits in human
-- units -- finalize goes through create_manual_inventory_item, and
-- services/receipt_imports.py converts there); stock_warning_ignores
-- .reference_unit (still a display unit -- the warnings service compares
-- it against the item's display_unit, and the ignore self-heals via its
-- reference_purchased_at key if that ever drifts).

-- =========================================================================
-- 0. Temp helper: 1 <unit> -> N base units. Same numbers as
--    services/units.py's _TO_BASE. Dropped at the end -- the live
--    conversion path is Python's, this only exists for the backfill.
-- =========================================================================

create function _to_base_factor(u unit) returns numeric
language sql
immutable
as $$
  select case u
    when 'g'      then 1
    when 'kg'     then 1000
    when 'oz'     then 28.3495
    when 'lb'     then 453.592
    when 'ml'     then 1
    when 'l'      then 1000
    when 'tsp'    then 4.92892
    when 'tbsp'   then 14.7868
    when 'fl_oz'  then 29.5735
    when 'cup'    then 236.588
    when 'pt'     then 473.176
    when 'qt'     then 946.353
    when 'gal'    then 3785.41
    when 'count'  then 1
  end::numeric;
$$;

-- =========================================================================
-- 1. purchase_corrections -- historical snapshots of an item's
--    total_quantity, in that item's (old) unit. Widen the columns first
--    (a base value can be ~3785x the display value -- gallons -- and would
--    overflow numeric(10,3) mid-update), then convert while
--    inventory_items.preferred_unit still exists to read the factor from.
--    list_corrections converts these back to the item's current
--    display_unit on read.
-- =========================================================================

alter table public.purchase_corrections
  alter column previous_total_quantity type numeric,
  alter column new_total_quantity type numeric;

update public.purchase_corrections pc
set
  previous_total_quantity = pc.previous_total_quantity * _to_base_factor(i.preferred_unit),
  new_total_quantity = pc.new_total_quantity * _to_base_factor(i.preferred_unit)
from public.inventory_items i
where i.id = pc.inventory_item_id
  and (pc.previous_total_quantity is not null or pc.new_total_quantity is not null);

-- =========================================================================
-- 2. inventory_items -- convert both quantity columns to base, then rename
--    the unit column. Widened to unconstrained numeric (matching
--    ledger_entries.amount): the base value of 1 oz is 28.3495 g, so a
--    fixed 3-decimal scale would quantize at rest, which is what this
--    change exists to stop. The >= 0 / > 0 checks still hold (factors are
--    positive) and ride along unchanged.
-- =========================================================================

alter table public.inventory_items
  alter column quantity type numeric using (quantity * _to_base_factor(preferred_unit)),
  alter column total_quantity type numeric using (total_quantity * _to_base_factor(preferred_unit));

alter table public.inventory_items rename column preferred_unit to display_unit;

-- =========================================================================
-- 3. recipe_ingredients -- same treatment.
-- =========================================================================

alter table public.recipe_ingredients
  alter column quantity type numeric using (quantity * _to_base_factor(unit));

alter table public.recipe_ingredients rename column unit to display_unit;

-- =========================================================================
-- 4. RPCs -- same signatures (so PostgREST calls and grants are untouched),
--    bodies updated for the renamed column. p_quantity / the ingredient
--    `quantity` jsonb values are now already base values -- Python
--    converts before calling, so these just write them straight through.
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
    quantity, total_quantity, display_unit, cost, purchased_at, expiry_date, best_by_date,
    accounting_type, split_member_count, name_override
  ) values (
    p_household_id, v_variant_id, p_storage_location_id, v_purchase_event_id,
    p_quantity, p_quantity, p_preferred_unit::unit, p_cost, now(), p_expiry_date, p_best_by_date,
    p_accounting_type, case when p_accounting_type = 'PERSONAL' then null else v_member_count end,
    p_name_override
  )
  returning * into v_item;

  insert into public.inventory_item_allowed_members (inventory_item_id, member_id)
    select v_item.id, unnest(p_allowed_member_ids);

  return v_item;
end;
$$;

create or replace function public.create_recipe(
  p_user_id uuid,
  p_name text,
  p_description text,
  p_servings integer,
  p_prep_time_minutes integer,
  p_cook_time_minutes integer,
  p_instructions jsonb,
  p_ingredients jsonb
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe public.recipes;
begin
  insert into public.recipes (
    created_by_user_id, name, description, servings,
    prep_time_minutes, cook_time_minutes, instructions
  ) values (
    p_user_id, p_name, p_description, p_servings,
    p_prep_time_minutes, p_cook_time_minutes, coalesce(p_instructions, '[]'::jsonb)
  )
  returning * into v_recipe;

  insert into public.recipe_ingredients
    (recipe_id, global_food_definition_id, quantity, display_unit, note, position)
  select
    v_recipe.id,
    (ing ->> 'global_food_definition_id')::uuid,
    (ing ->> 'quantity')::numeric,
    (ing ->> 'unit')::unit,
    ing ->> 'note',
    (ord - 1)::integer
  from jsonb_array_elements(p_ingredients) with ordinality as t(ing, ord);

  return v_recipe;
end;
$$;

create or replace function public.update_recipe(
  p_user_id uuid,
  p_recipe_id uuid,
  p_name text,
  p_description text,
  p_servings integer,
  p_prep_time_minutes integer,
  p_cook_time_minutes integer,
  p_instructions jsonb,
  p_ingredients jsonb
)
returns public.recipes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipe public.recipes;
begin
  update public.recipes set
    name = p_name,
    description = p_description,
    servings = p_servings,
    prep_time_minutes = p_prep_time_minutes,
    cook_time_minutes = p_cook_time_minutes,
    instructions = coalesce(p_instructions, '[]'::jsonb)
  where id = p_recipe_id and created_by_user_id = p_user_id
  returning * into v_recipe;

  if v_recipe.id is null then
    raise exception 'RECIPE_NOT_FOUND';
  end if;

  delete from public.recipe_ingredients where recipe_id = p_recipe_id;

  insert into public.recipe_ingredients
    (recipe_id, global_food_definition_id, quantity, display_unit, note, position)
  select
    p_recipe_id,
    (ing ->> 'global_food_definition_id')::uuid,
    (ing ->> 'quantity')::numeric,
    (ing ->> 'unit')::unit,
    ing ->> 'note',
    (ord - 1)::integer
  from jsonb_array_elements(p_ingredients) with ordinality as t(ing, ord);

  return v_recipe;
end;
$$;

-- =========================================================================
-- 5. Done with the backfill helper.
-- =========================================================================

drop function _to_base_factor(unit);
