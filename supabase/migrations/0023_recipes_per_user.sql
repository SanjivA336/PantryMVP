-- Recipes become a personal recipe box (owned by a user) instead of shared
-- household data. A household member's recipes used to be automatically
-- visible to every other member; now they're private by default, and
-- sharing between people is an explicit action (export/import a JSON file --
-- see recipe_ai.py's json import path) rather than implicit household
-- membership.
--
-- Existing recipes are dropped rather than migrated: there's no household
-- member -> single user mapping worth preserving (a member row is
-- per-household, a user spans households), and what's in the table today is
-- test data, not anything worth carrying forward under the new model.

delete from public.recipe_ingredients;
delete from public.recipes;

-- Policies referencing household_id must go before the column drop below,
-- not after -- Postgres won't drop a column any policy still depends on.
drop policy recipes_select on public.recipes;
drop policy recipes_insert on public.recipes;
drop policy recipes_update on public.recipes;
drop policy recipes_delete on public.recipes;

drop policy recipe_ingredients_select on public.recipe_ingredients;
drop policy recipe_ingredients_insert on public.recipe_ingredients;
drop policy recipe_ingredients_update on public.recipe_ingredients;
drop policy recipe_ingredients_delete on public.recipe_ingredients;

alter table public.recipes
  drop column household_id,
  drop column created_by_member_id,
  add column created_by_user_id uuid not null references public.users (id) on delete cascade;

create index recipes_created_by_user_id_idx on public.recipes (created_by_user_id);

-- =========================================================================
-- RLS -- owner-only now, not "any household member"
-- =========================================================================

create policy recipes_select on public.recipes
  for select
  using (created_by_user_id = auth.uid());
create policy recipes_insert on public.recipes
  for insert
  with check (created_by_user_id = auth.uid());
create policy recipes_update on public.recipes
  for update
  using (created_by_user_id = auth.uid());
create policy recipes_delete on public.recipes
  for delete
  using (created_by_user_id = auth.uid());

create policy recipe_ingredients_select on public.recipe_ingredients
  for select
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.created_by_user_id = auth.uid()
    )
  );
create policy recipe_ingredients_insert on public.recipe_ingredients
  for insert
  with check (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.created_by_user_id = auth.uid()
    )
  );
create policy recipe_ingredients_update on public.recipe_ingredients
  for update
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.created_by_user_id = auth.uid()
    )
  );
create policy recipe_ingredients_delete on public.recipe_ingredients
  for delete
  using (
    exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.created_by_user_id = auth.uid()
    )
  );

-- =========================================================================
-- create_recipe / update_recipe -- keyed off the creating user, not a
-- household member. household_id is dropped from both signatures entirely
-- (FastAPI still passes one through in the URL for routing/availability
-- purposes, but it never reaches these RPCs anymore).
-- =========================================================================

drop function if exists public.create_recipe(uuid, uuid, text, text, integer, integer, integer, jsonb, jsonb);

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
    ing ->> 'unit',
    ing ->> 'note',
    (ord - 1)::integer
  from jsonb_array_elements(p_ingredients) with ordinality as t(ing, ord);

  return v_recipe;
end;
$$;

revoke execute on function public.create_recipe(
  uuid, text, text, integer, integer, integer, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.create_recipe(
  uuid, text, text, integer, integer, integer, jsonb, jsonb
) to service_role;

drop function if exists public.update_recipe(uuid, uuid, text, text, integer, integer, integer, jsonb, jsonb);

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
