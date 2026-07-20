-- Phase 5: recipes (manual creation only). Ingredients link to the shared
-- global_food_definitions catalog (not a household_food_variant) -- a
-- recipe describes a food conceptually, and the household-specific variant
-- only matters once something is actually purchased. Availability matching
-- (against live inventory) is computed at read time in the service layer,
-- not stored here.
--
-- create_recipe/update_recipe are RPCs because writing a recipe is
-- genuinely multi-row (the recipe plus all of its ingredients) and
-- supabase-py's .table() calls are independent PostgREST requests with no
-- shared transaction -- a partial failure between them would leave an
-- orphaned recipe with the wrong ingredient list.

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by_member_id uuid not null references public.members (id) on delete restrict,
  name text not null,
  description text,
  servings integer not null check (servings > 0),
  prep_time_minutes integer check (prep_time_minutes >= 0),
  cook_time_minutes integer check (cook_time_minutes >= 0),
  -- Ordered array of step strings -- simpler than a separate steps table
  -- for MVP; order is just array order, no per-step metadata needed yet.
  instructions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_household_id_idx on public.recipes (household_id);

create trigger recipes_set_updated_at
  before update on public.recipes
  for each row execute function public.set_updated_at();

create table public.recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  global_food_definition_id uuid not null references public.global_food_definitions (id) on delete restrict,
  quantity numeric(10, 3) not null check (quantity > 0),
  unit text not null,
  note text,
  position integer not null
);

create index recipe_ingredients_recipe_id_idx on public.recipe_ingredients (recipe_id);
create index recipe_ingredients_food_definition_idx
  on public.recipe_ingredients (global_food_definition_id);

-- =========================================================================
-- RLS -- ordinary mutable household data, same permissive "any member"
-- model as storage_locations/shopping_list. The RPCs below are how FastAPI
-- actually writes these tables, but that doesn't need locking down the
-- direct-write policies too (recipe_ingredients isn't a financial/audit
-- table, and inventory_item_allowed_members sets the precedent for an
-- RPC-populated table still carrying normal member-write policies).
-- =========================================================================

alter table public.recipes enable row level security;
alter table public.recipe_ingredients enable row level security;

create policy recipes_select on public.recipes
  for select
  using (public.is_household_member(household_id));
create policy recipes_insert on public.recipes
  for insert
  with check (public.is_household_member(household_id));
create policy recipes_update on public.recipes
  for update
  using (public.is_household_member(household_id));
create policy recipes_delete on public.recipes
  for delete
  using (public.is_household_member(household_id));

create policy recipe_ingredients_select on public.recipe_ingredients
  for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and public.is_household_member(r.household_id)
    )
  );
create policy recipe_ingredients_insert on public.recipe_ingredients
  for insert
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and public.is_household_member(r.household_id)
    )
  );
create policy recipe_ingredients_update on public.recipe_ingredients
  for update
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and public.is_household_member(r.household_id)
    )
  );
create policy recipe_ingredients_delete on public.recipe_ingredients
  for delete
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and public.is_household_member(r.household_id)
    )
  );

-- =========================================================================
-- create_recipe
-- =========================================================================

create or replace function public.create_recipe(
  p_household_id uuid,
  p_member_id uuid,
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
    household_id, created_by_member_id, name, description, servings,
    prep_time_minutes, cook_time_minutes, instructions
  ) values (
    p_household_id, p_member_id, p_name, p_description, p_servings,
    p_prep_time_minutes, p_cook_time_minutes, coalesce(p_instructions, '[]'::jsonb)
  )
  returning * into v_recipe;

  insert into public.recipe_ingredients
    (recipe_id, global_food_definition_id, quantity, unit, note, position)
  select
    v_recipe.id,
    (ing ->> 'global_food_definition_id')::uuid,
    (ing ->> 'quantity')::numeric,
    ing ->> 'unit',
    ing ->> 'note',
    (ord - 1)::integer
  from jsonb_array_elements(p_ingredients) with ordinality as t(ing, ord);

  return v_recipe;
end;
$$;

revoke execute on function public.create_recipe(
  uuid, uuid, text, text, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_recipe(
  uuid, uuid, text, text, integer, integer, integer, jsonb, jsonb
) to service_role;

-- =========================================================================
-- update_recipe -- full replace of both the recipe row and its ingredient
-- list (delete-then-reinsert), matching how the frontend form always
-- submits the complete ingredient set rather than incremental edits.
-- =========================================================================

create or replace function public.update_recipe(
  p_household_id uuid,
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
  where id = p_recipe_id and household_id = p_household_id
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
    ing ->> 'unit',
    ing ->> 'note',
    (ord - 1)::integer
  from jsonb_array_elements(p_ingredients) with ordinality as t(ing, ord);

  return v_recipe;
end;
$$;

revoke execute on function public.update_recipe(
  uuid, uuid, text, text, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.update_recipe(
  uuid, uuid, text, text, integer, integer, integer, jsonb, jsonb
) to service_role;
