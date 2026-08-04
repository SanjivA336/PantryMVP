-- Warning ignores: lets a household temporarily dismiss a stock or expiry
-- warning until the underlying signal actually changes. Distinct from
-- shopping_list_ignored_variants (a deliberate, permanent "never suggest
-- again") -- these are meant to self-clear.
--
-- Stock ignores are keyed to the specific purchase they were computed
-- against (reference_purchased_at): a newer purchase changes that value,
-- which naturally un-suppresses the warning with no cleanup job needed.
-- Expiry ignores are keyed to the specific inventory item, since a given
-- item's expiry status is fixed until it's consumed/discarded -- which
-- already removes it from the ACTIVE set warnings are computed over.

create table public.stock_warning_ignores (
  household_id uuid not null references public.households (id) on delete cascade,
  household_food_variant_id uuid not null references public.household_food_variants (id) on delete cascade,
  reference_purchased_at timestamptz not null,
  ignored_at timestamptz not null default now(),
  primary key (household_id, household_food_variant_id)
);

alter table public.stock_warning_ignores enable row level security;

create policy stock_warning_ignores_select on public.stock_warning_ignores
  for select
  using (public.is_household_member(household_id));
create policy stock_warning_ignores_insert on public.stock_warning_ignores
  for insert
  with check (public.is_household_member(household_id));
create policy stock_warning_ignores_delete on public.stock_warning_ignores
  for delete
  using (public.is_household_member(household_id));

create table public.expiry_warning_ignores (
  household_id uuid not null references public.households (id) on delete cascade,
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  ignored_at timestamptz not null default now(),
  primary key (household_id, inventory_item_id)
);

alter table public.expiry_warning_ignores enable row level security;

create policy expiry_warning_ignores_select on public.expiry_warning_ignores
  for select
  using (public.is_household_member(household_id));
create policy expiry_warning_ignores_insert on public.expiry_warning_ignores
  for insert
  with check (public.is_household_member(household_id));
create policy expiry_warning_ignores_delete on public.expiry_warning_ignores
  for delete
  using (public.is_household_member(household_id));
