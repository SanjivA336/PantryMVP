-- Replaces every freeform-text "unit" column with a closed enum. Units were
-- plain `text` on global_food_definitions.preferred_unit,
-- inventory_items.preferred_unit, recipe_ingredients.unit,
-- stock_warning_ignores.reference_unit, and receipt_import_items.preferred_unit
-- -- nothing stopped a typo or an AI-parsed value like "stick"/"gal" from
-- being stored, which services/units.py's guess_dimension/guess_system have
-- always had to guess about as a result. A closed vocabulary removes the
-- guessing at the source.
--
-- COUNT deliberately stays exactly one value ('count') rather than
-- enumerating package types (bag, box, can, dozen, ...): a "bag" or "can"
-- has no fixed quantity a conversion could rely on (unlike dozen->each,
-- which is fixed but still not worth a special case for one pairing), so a
-- richer COUNT vocabulary would only look more precise than it actually is.
-- receipt_import_items.parsed_unit is deliberately NOT touched here -- it's
-- the raw, never-edited AI/OCR guess kept for audit context, and forcing it
-- through this enum would mean dropping legitimate AI output that doesn't
-- map cleanly. Only receipt_import_items.preferred_unit (the editable,
-- confirmable field) becomes the enum.

create type unit as enum (
  'g', 'kg', 'oz', 'lb',
  'ml', 'l', 'tsp', 'tbsp', 'fl_oz', 'cup', 'pt', 'qt', 'gal',
  'count'
);

-- One-time helper for the ALTER ... USING clauses below -- maps every value
-- already recognized by services/units.py's wider vocabulary (plus a few
-- obvious pluralizations/spellings) onto the new enum unchanged, and
-- anything else (confirmed by test fixtures to include at least "stick" and
-- the placeholder "unit") down to 'count', the same safe bucket
-- guess_dimension already fell back to for unrecognized text. A null input
-- stays null, since receipt_import_items.preferred_unit's nullability means
-- something specific ("no unit guessed yet"), not "unknown unit". Dropped
-- at the end of this migration; it only exists to keep the five ALTERs
-- below readable.
create function normalize_legacy_unit(raw text) returns unit
language sql
immutable
as $$
  select case
    when raw is null then null::unit
    else (
      case lower(trim(raw))
        when 'g' then 'g'::unit
        when 'kg' then 'kg'::unit
        when 'oz' then 'oz'::unit
        when 'lb' then 'lb'::unit
        when 'lbs' then 'lb'::unit
        when 'ml' then 'ml'::unit
        when 'l' then 'l'::unit
        when 'tsp' then 'tsp'::unit
        when 'tbsp' then 'tbsp'::unit
        when 'fl_oz' then 'fl_oz'::unit
        when 'fl oz' then 'fl_oz'::unit
        when 'cup' then 'cup'::unit
        when 'cups' then 'cup'::unit
        when 'pt' then 'pt'::unit
        when 'pint' then 'pt'::unit
        when 'qt' then 'qt'::unit
        when 'quart' then 'qt'::unit
        when 'gal' then 'gal'::unit
        when 'gallon' then 'gal'::unit
        when 'count' then 'count'::unit
        when 'each' then 'count'::unit
        else 'count'::unit
      end
    )
  end;
$$;

alter table public.global_food_definitions
  alter column preferred_unit type unit using normalize_legacy_unit(preferred_unit);

alter table public.inventory_items
  alter column preferred_unit type unit using normalize_legacy_unit(preferred_unit);

alter table public.recipe_ingredients
  alter column unit type unit using normalize_legacy_unit(unit);

alter table public.stock_warning_ignores
  alter column reference_unit type unit using normalize_legacy_unit(reference_unit);

alter table public.receipt_import_items
  alter column preferred_unit type unit using normalize_legacy_unit(preferred_unit);

drop function normalize_legacy_unit(text);

-- =========================================================================
-- create_manual_inventory_item -- same signature (p_preferred_unit stays
-- `text` so PostgREST's RPC call needs no changes), cast to `unit` only at
-- the point it's actually written.
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

-- =========================================================================
-- create_recipe / update_recipe -- same signatures (p_ingredients stays
-- jsonb), cast each ingredient's unit to `unit` when it's extracted.
-- =========================================================================

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
    (recipe_id, global_food_definition_id, quantity, unit, note, position)
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
    (recipe_id, global_food_definition_id, quantity, unit, note, position)
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
