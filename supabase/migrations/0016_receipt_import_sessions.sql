-- Phase 6: receipt import sessions + items, and a signature change to
-- create_manual_inventory_item so finalized receipt lines can carry the
-- source receipt's image path through to the resulting purchase_events row.

create type receipt_import_session_status as enum (
  'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'FINALIZED'
);
create type receipt_import_item_status as enum (
  'NEEDS_REVIEW', 'CONFIRMED', 'SKIPPED', 'IMPORTED'
);

-- =========================================================================
-- receipt_import_sessions
-- =========================================================================

create table public.receipt_import_sessions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  created_by_member_id uuid not null references public.members (id) on delete restrict,
  status receipt_import_session_status not null default 'PENDING',
  -- Storage object path ("{household_id}/{session_id}.{ext}"), not a
  -- literal URL -- resolved to a signed URL at read time by the frontend.
  image_path text not null,
  ocr_engine text,
  raw_ocr_text text,
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index receipt_import_sessions_household_id_idx
  on public.receipt_import_sessions (household_id, created_at desc);

create trigger receipt_import_sessions_set_updated_at
  before update on public.receipt_import_sessions
  for each row execute function public.set_updated_at();

-- =========================================================================
-- receipt_import_items
-- =========================================================================

create table public.receipt_import_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.receipt_import_sessions (id) on delete cascade,
  position integer not null,
  -- Raw parser output -- never edited, kept for context/debugging.
  raw_line_text text not null,
  parsed_name text,
  parsed_quantity numeric(10, 3),
  parsed_unit text,
  parsed_price numeric(10, 2),
  -- Editable/confirmable fields, mirroring CreateInventoryItemRequest's
  -- shape so finalize can hand these straight to create_manual_inventory_item.
  global_food_definition_id uuid references public.global_food_definitions (id) on delete set null,
  storage_location_id uuid references public.storage_locations (id) on delete set null,
  quantity numeric(10, 3),
  preferred_unit text,
  cost numeric(10, 2),
  accounting_type accounting_type,
  allowed_member_ids uuid[] not null default '{}',
  status receipt_import_item_status not null default 'NEEDS_REVIEW',
  -- Idempotency marker: finalize is N separate RPC calls (one per item),
  -- not one transaction. Set once this item has produced a real inventory
  -- item, so a re-run of finalize (after a partial failure) skips it
  -- instead of importing it twice.
  created_inventory_item_id uuid references public.inventory_items (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index receipt_import_items_session_id_idx
  on public.receipt_import_items (session_id, position);

create trigger receipt_import_items_set_updated_at
  before update on public.receipt_import_items
  for each row execute function public.set_updated_at();

-- =========================================================================
-- RLS -- staging data, not money or an audit trail, so this follows the
-- recipes/recipe_ingredients precedent (permissive member CRUD) rather
-- than the ledger's locked-down single-writer model. No delete policy on
-- either table -- nothing in this phase deletes a session or item row.
-- =========================================================================

alter table public.receipt_import_sessions enable row level security;
alter table public.receipt_import_items enable row level security;

create policy receipt_import_sessions_select on public.receipt_import_sessions
  for select
  using (public.is_household_member(household_id));
create policy receipt_import_sessions_insert on public.receipt_import_sessions
  for insert
  with check (public.is_household_member(household_id));
create policy receipt_import_sessions_update on public.receipt_import_sessions
  for update
  using (public.is_household_member(household_id));

create policy receipt_import_items_select on public.receipt_import_items
  for select
  using (
    exists (
      select 1 from public.receipt_import_sessions s
      where s.id = session_id and public.is_household_member(s.household_id)
    )
  );
create policy receipt_import_items_insert on public.receipt_import_items
  for insert
  with check (
    exists (
      select 1 from public.receipt_import_sessions s
      where s.id = session_id and public.is_household_member(s.household_id)
    )
  );
create policy receipt_import_items_update on public.receipt_import_items
  for update
  using (
    exists (
      select 1 from public.receipt_import_sessions s
      where s.id = session_id and public.is_household_member(s.household_id)
    )
  );

-- =========================================================================
-- create_manual_inventory_item: add an optional trailing p_receipt_image_path,
-- threaded into purchase_events.receipt_image_url (an existing, previously
-- unused column -- clearly intended for exactly this).
--
-- A trailing parameter with a DEFAULT still changes the function's
-- signature/identity in Postgres (identity is the full ordered parameter
-- TYPE list, defaults don't factor in) -- CREATE OR REPLACE with a longer
-- parameter list creates a new overload alongside the old one rather than
-- replacing it, exactly like when p_accounting_type was added in 0009.
-- Must drop the current 11-parameter signature explicitly first.
-- =========================================================================

drop function if exists public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type
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
  p_receipt_image_path text default null
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

  insert into public.purchase_events (household_id, member_id, total_cost, purchased_at, receipt_image_url)
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
    accounting_type, split_member_count
  ) values (
    p_household_id, v_variant_id, p_storage_location_id, v_purchase_event_id,
    p_quantity, p_quantity, p_preferred_unit, p_cost, now(), p_expiry_date, p_best_by_date,
    p_accounting_type, case when p_accounting_type = 'PERSONAL' then null else v_member_count end
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
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text
) from public, anon, authenticated;
grant execute on function public.create_manual_inventory_item(
  uuid, uuid, uuid, uuid, numeric, text, numeric, date, date, uuid[], accounting_type, text
) to service_role;
