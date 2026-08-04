-- Shopping list v2: manual reordering, a "collected" (in-cart) state
-- distinct from removal, food-type-linked manual items, and a genuine
-- permanent-ignore mechanism for suggestions (today's only "ignore" is the
-- soft-delete/removed_at comparison in suggest_items(), which is inherently
-- temporary -- a newer purchase makes the item eligible again).

alter table public.shopping_list_sections
  add column sort_order integer not null default 0;

alter table public.shopping_list_items
  add column sort_order integer not null default 0,
  add column collected boolean not null default false;

-- =========================================================================
-- shopping_list_ignored_variants -- a food the household never wants
-- suggested again, regardless of stock level or purchase history. Separate
-- from the removed_at dismissal check (which only holds until the next
-- purchase) since this is a stronger, explicit "stop suggesting this" signal
-- the user opts into deliberately, not an implicit side effect of removing
-- an item from the list.
-- =========================================================================

create table public.shopping_list_ignored_variants (
  household_id uuid not null references public.households (id) on delete cascade,
  household_food_variant_id uuid not null references public.household_food_variants (id) on delete cascade,
  ignored_at timestamptz not null default now(),
  primary key (household_id, household_food_variant_id)
);

alter table public.shopping_list_ignored_variants enable row level security;

create policy shopping_list_ignored_variants_select on public.shopping_list_ignored_variants
  for select
  using (public.is_household_member(household_id));
create policy shopping_list_ignored_variants_insert on public.shopping_list_ignored_variants
  for insert
  with check (public.is_household_member(household_id));
create policy shopping_list_ignored_variants_delete on public.shopping_list_ignored_variants
  for delete
  using (public.is_household_member(household_id));

-- =========================================================================
-- find_or_create_household_food_variant -- extracts the get-or-create
-- pattern that's inlined separately inside create_manual_inventory_item
-- (0006/0009/0018) and the receipt-import finalize RPC (0016), so the
-- shopping list's new food-linked manual-add flow doesn't need a fifth
-- copy of the same three statements.
-- =========================================================================

create or replace function public.find_or_create_household_food_variant(
  p_household_id uuid,
  p_global_food_definition_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_variant_id uuid;
begin
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

  return v_variant_id;
end;
$$;

revoke execute on function public.find_or_create_household_food_variant from public, anon, authenticated;
grant execute on function public.find_or_create_household_food_variant to service_role;
