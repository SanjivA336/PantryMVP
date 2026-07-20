-- Phase 2a: food definitions + manual inventory tracking.
-- No ledger/accounting tables yet — that's Phase 2b. This phase only
-- tracks what a household owns, not who owes whom for it.

-- =========================================================================
-- Extensions & enums
-- =========================================================================

-- Trigram indexing for fuzzy food-name search (e.g. "WHOLE MIK" ~ "Whole Milk").
create extension if not exists pg_trgm;

create type accounting_type as enum ('UNIT_BASED', 'SHARED_CONSUMABLE', 'PERSONAL');
create type inventory_item_status as enum ('ACTIVE', 'EMPTY', 'DISCARDED', 'EXPIRED', 'LOST');

-- =========================================================================
-- global_food_definitions — shared across all households
-- =========================================================================

create table public.global_food_definitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  preferred_unit text not null,
  food_group text,
  accounting_type_default accounting_type not null default 'SHARED_CONSUMABLE',
  shelf_life_days integer,
  freezer_shelf_life_days integer,
  common_substitutions jsonb not null default '[]'::jsonb,
  created_by_user_id uuid references public.users (id) on delete set null,
  is_verified boolean not null default false,
  usage_count integer not null default 0,
  duplicate_of_id uuid references public.global_food_definitions (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Trigram GIN index powers fuzzy `%` similarity search; a plain btree on
-- (is_verified, usage_count) supports the ranking sort.
create index global_food_definitions_name_trgm_idx
  on public.global_food_definitions using gin (name gin_trgm_ops);
create index global_food_definitions_ranking_idx
  on public.global_food_definitions (is_verified desc, usage_count desc);

create trigger global_food_definitions_set_updated_at
  before update on public.global_food_definitions
  for each row execute function public.set_updated_at();

-- =========================================================================
-- household_food_variants — household-specific customizations
-- =========================================================================

create table public.household_food_variants (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  global_food_definition_id uuid references public.global_food_definitions (id) on delete set null,
  name_override text,
  shelf_life_days_override integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A household should only ever have one variant per global definition —
-- re-picking "Whole Milk" reuses the existing variant instead of duplicating.
-- Household-local creations (global_food_definition_id is null) are exempt,
-- since there's nothing to dedupe against.
create unique index household_food_variants_unique_global
  on public.household_food_variants (household_id, global_food_definition_id)
  where global_food_definition_id is not null;

create index household_food_variants_household_id_idx
  on public.household_food_variants (household_id);

create trigger household_food_variants_set_updated_at
  before update on public.household_food_variants
  for each row execute function public.set_updated_at();

-- =========================================================================
-- purchase_events — one per manual "add item" or (later) receipt import
-- =========================================================================

create table public.purchase_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete restrict,
  total_cost numeric(10, 2) not null default 0,
  purchased_at timestamptz not null default now(),
  receipt_image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchase_events_household_id_idx on public.purchase_events (household_id);

create trigger purchase_events_set_updated_at
  before update on public.purchase_events
  for each row execute function public.set_updated_at();

-- =========================================================================
-- inventory_items
-- =========================================================================

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  household_food_variant_id uuid not null references public.household_food_variants (id) on delete restrict,
  storage_location_id uuid not null references public.storage_locations (id) on delete restrict,
  purchase_event_id uuid not null references public.purchase_events (id) on delete restrict,
  quantity numeric(10, 3) not null check (quantity >= 0),
  total_quantity numeric(10, 3) not null check (total_quantity > 0),
  preferred_unit text not null,
  cost numeric(10, 2) not null default 0,
  purchased_at timestamptz not null default now(),
  expiry_date date,
  best_by_date date,
  freeze_by_date date,
  is_frozen boolean not null default false,
  freeze_date date,
  status inventory_item_status not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index inventory_items_household_id_idx on public.inventory_items (household_id);
create index inventory_items_status_idx on public.inventory_items (household_id, status);
create index inventory_items_storage_location_idx on public.inventory_items (storage_location_id);

-- Auto-transition to EMPTY when quantity hits zero, and stamp updated_at —
-- one trigger handles both instead of stacking two BEFORE UPDATE triggers.
create or replace function public.inventory_items_before_update()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.quantity = 0 and new.status = 'ACTIVE' then
    new.status := 'EMPTY';
  end if;
  return new;
end;
$$;

create trigger inventory_items_before_update
  before update on public.inventory_items
  for each row execute function public.inventory_items_before_update();

-- Increment the global definition's usage_count whenever a household adds
-- an item against it — drives the search-ranking "popularity" signal.
-- Household-local-only variants (no global_food_definition_id) are skipped.
create or replace function public.bump_food_definition_usage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_global_id uuid;
begin
  select global_food_definition_id into v_global_id
  from public.household_food_variants
  where id = new.household_food_variant_id;

  if v_global_id is not null then
    update public.global_food_definitions
      set usage_count = usage_count + 1
      where id = v_global_id;
  end if;

  return new;
end;
$$;

create trigger inventory_items_bump_usage
  after insert on public.inventory_items
  for each row execute function public.bump_food_definition_usage();

-- =========================================================================
-- inventory_item_allowed_members — who's allowed to use this item
-- =========================================================================

create table public.inventory_item_allowed_members (
  inventory_item_id uuid not null references public.inventory_items (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  primary key (inventory_item_id, member_id)
);

-- =========================================================================
-- consumption_events — immutable usage log
-- =========================================================================

create table public.consumption_events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  quantity_used numeric(10, 3) not null check (quantity_used > 0),
  consumed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index consumption_events_household_id_idx on public.consumption_events (household_id);
create index consumption_events_inventory_item_id_idx on public.consumption_events (inventory_item_id);

-- =========================================================================
-- Immutability: purchase_events and consumption_events are an audit trail.
-- Enforced as rejecting triggers (not just revoked grants) so it holds
-- regardless of which role — including service_role — attempts the write.
-- =========================================================================

create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'rows in % are immutable and cannot be % — % id=%',
    TG_TABLE_NAME, lower(TG_OP), TG_OP, coalesce(old.id, new.id);
end;
$$;

create trigger purchase_events_no_update
  before update on public.purchase_events
  for each row execute function public.reject_mutation();
create trigger purchase_events_no_delete
  before delete on public.purchase_events
  for each row execute function public.reject_mutation();

create trigger consumption_events_no_update
  before update on public.consumption_events
  for each row execute function public.reject_mutation();
create trigger consumption_events_no_delete
  before delete on public.consumption_events
  for each row execute function public.reject_mutation();

-- =========================================================================
-- RLS
-- =========================================================================

alter table public.global_food_definitions enable row level security;
alter table public.household_food_variants enable row level security;
alter table public.purchase_events enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_item_allowed_members enable row level security;
alter table public.consumption_events enable row level security;

-- global_food_definitions: readable by any authenticated user (it's a
-- shared catalog, not household-scoped); insertable by any authenticated
-- user (matches "users can create custom definitions" from the design doc).
-- No update/delete policy — edits go through FastAPI's service-role path
-- only (e.g. verification status, duplicate merging), never client-direct.
create policy global_food_definitions_select on public.global_food_definitions
  for select
  to authenticated
  using (true);

create policy global_food_definitions_insert on public.global_food_definitions
  for insert
  to authenticated
  with check (created_by_user_id = auth.uid());

-- household_food_variants
create policy household_food_variants_select on public.household_food_variants
  for select
  using (public.is_household_member(household_id));
create policy household_food_variants_insert on public.household_food_variants
  for insert
  with check (public.is_household_member(household_id));

-- purchase_events: members can read and create (create is a manual "I bought
-- this" declaration); no update/delete policy at all — immutable, and the
-- triggers above back this up even against direct SQL.
create policy purchase_events_select on public.purchase_events
  for select
  using (public.is_household_member(household_id));
create policy purchase_events_insert on public.purchase_events
  for insert
  with check (public.is_household_member(household_id));

-- inventory_items
create policy inventory_items_select on public.inventory_items
  for select
  using (public.is_household_member(household_id));
create policy inventory_items_insert on public.inventory_items
  for insert
  with check (public.is_household_member(household_id));
create policy inventory_items_update on public.inventory_items
  for update
  using (public.is_household_member(household_id));

-- inventory_item_allowed_members
create policy inventory_item_allowed_members_select on public.inventory_item_allowed_members
  for select
  using (
    exists (
      select 1 from public.inventory_items i
      where i.id = inventory_item_id and public.is_household_member(i.household_id)
    )
  );
create policy inventory_item_allowed_members_insert on public.inventory_item_allowed_members
  for insert
  with check (
    exists (
      select 1 from public.inventory_items i
      where i.id = inventory_item_id and public.is_household_member(i.household_id)
    )
  );
create policy inventory_item_allowed_members_delete on public.inventory_item_allowed_members
  for delete
  using (
    exists (
      select 1 from public.inventory_items i
      where i.id = inventory_item_id and public.is_household_member(i.household_id)
    )
  );

-- consumption_events: members can read and create; no update/delete policy
-- (immutable, same as purchase_events).
create policy consumption_events_select on public.consumption_events
  for select
  using (public.is_household_member(household_id));
create policy consumption_events_insert on public.consumption_events
  for insert
  with check (public.is_household_member(household_id));
