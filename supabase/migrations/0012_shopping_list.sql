-- Phase 4: shopping list. Manual add/remove plus a "Suggest List" button
-- that proposes items from the warnings layer's stock signals -- suggested
-- items are tagged distinctly (source = 'SUGGESTED') from manual adds, and
-- removing a suggested item is a soft-delete (status = 'REMOVED', not a row
-- delete) specifically so the suggest algorithm can tell "never suggested"
-- apart from "suggested and dismissed" and avoid silently re-adding
-- something the user just removed.

create type shopping_list_item_source as enum ('MANUAL', 'SUGGESTED');
create type shopping_list_item_status as enum ('ACTIVE', 'REMOVED');

-- =========================================================================
-- shopping_list_sections -- user-created, freeform (Apple Reminders-style),
-- not auto-sorted by aisle. Ordered by created_at; no manual reordering in
-- this phase.
-- =========================================================================

create table public.shopping_list_sections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shopping_list_sections_household_id_idx
  on public.shopping_list_sections (household_id);

create trigger shopping_list_sections_set_updated_at
  before update on public.shopping_list_sections
  for each row execute function public.set_updated_at();

-- =========================================================================
-- shopping_list_items
-- =========================================================================

create table public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  section_id uuid references public.shopping_list_sections (id) on delete set null,
  name text not null,
  -- Set only for SUGGESTED items (resolved from the warnings signal that
  -- produced them). MANUAL items are plain freeform text with no catalog
  -- link -- keeps the manual "add to list" flow a single text field rather
  -- than requiring a food-search step for things like "paper towels".
  household_food_variant_id uuid references public.household_food_variants (id) on delete set null,
  source shopping_list_item_source not null,
  status shopping_list_item_status not null default 'ACTIVE',
  added_by_member_id uuid not null references public.members (id) on delete restrict,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'REMOVED') = (removed_at is not null))
);

create index shopping_list_items_household_id_idx on public.shopping_list_items (household_id);
create index shopping_list_items_household_status_idx
  on public.shopping_list_items (household_id, status);
-- Backs the suggest algorithm's per-variant lookup (existing active/removed
-- rows for a food it's about to consider suggesting).
create index shopping_list_items_variant_idx
  on public.shopping_list_items (household_id, household_food_variant_id)
  where household_food_variant_id is not null;

create trigger shopping_list_items_set_updated_at
  before update on public.shopping_list_items
  for each row execute function public.set_updated_at();

-- =========================================================================
-- RLS -- ordinary mutable household-shared data (not a financial/audit
-- table), so this follows storage_locations' permissive "any member" model
-- rather than the ledger's single-writer/immutable one. Item removal goes
-- through an UPDATE (status -> REMOVED), not a real DELETE, so history is
-- kept for the dismissal check -- no delete policy on shopping_list_items.
-- Sections have no dismissal semantics to preserve, so a real delete is
-- fine there.
-- =========================================================================

alter table public.shopping_list_sections enable row level security;
alter table public.shopping_list_items enable row level security;

create policy shopping_list_sections_select on public.shopping_list_sections
  for select
  using (public.is_household_member(household_id));
create policy shopping_list_sections_insert on public.shopping_list_sections
  for insert
  with check (public.is_household_member(household_id));
create policy shopping_list_sections_update on public.shopping_list_sections
  for update
  using (public.is_household_member(household_id));
create policy shopping_list_sections_delete on public.shopping_list_sections
  for delete
  using (public.is_household_member(household_id));

create policy shopping_list_items_select on public.shopping_list_items
  for select
  using (public.is_household_member(household_id));
create policy shopping_list_items_insert on public.shopping_list_items
  for insert
  with check (public.is_household_member(household_id));
create policy shopping_list_items_update on public.shopping_list_items
  for update
  using (public.is_household_member(household_id));
