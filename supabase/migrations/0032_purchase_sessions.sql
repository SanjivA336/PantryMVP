-- Generalize receipt import into "purchase sessions".
--
-- The review-and-finalize machinery built for receipt scanning (a draft
-- session, per-line editable rows, an idempotent finalize that only writes
-- to inventory at the end) is exactly what the shopping list's "bought
-- marked items" wizard needs. Rather than a parallel system, this renames
-- receipt_import_sessions / receipt_import_items to purchase_sessions /
-- purchase_session_items and adds:
--
--   * source          -- RECEIPT_SCAN (today's flow) or SHOPPING_LIST
--   * image_path       -- now nullable; only RECEIPT_SCAN sessions have one
--   * shopping_list_item_id  -- which list item a line came from (nullable:
--                              a line can also be added ad hoc in the wizard)
--   * buyer_member_id  -- per-line buyer (the wizard's sticky-buyer flow);
--                        finalize falls back to the session creator
--
-- Item status collapses: NEEDS_REVIEW -> PENDING, CONFIRMED -> COMPLETE.
-- SKIPPED is left as a now-unused enum label (Postgres can't drop enum
-- values) -- nothing writes it anymore; the wizard requires every line
-- COMPLETE before it can finalize.
--
-- The receipt-images Storage bucket and its policies are untouched -- a
-- SHOPPING_LIST session simply never uses them.

-- =========================================================================
-- Types
-- =========================================================================

alter type public.receipt_import_session_status rename to purchase_session_status;

alter type public.receipt_import_item_status rename to purchase_session_item_status;
alter type public.purchase_session_item_status rename value 'NEEDS_REVIEW' to 'PENDING';
alter type public.purchase_session_item_status rename value 'CONFIRMED' to 'COMPLETE';

create type public.purchase_session_source as enum ('RECEIPT_SCAN', 'SHOPPING_LIST');

-- =========================================================================
-- Tables
-- =========================================================================

alter table public.receipt_import_sessions rename to purchase_sessions;
alter table public.receipt_import_items rename to purchase_session_items;

alter table public.purchase_sessions
  alter column image_path drop not null,
  add column source public.purchase_session_source not null default 'RECEIPT_SCAN';

alter table public.purchase_session_items
  add column shopping_list_item_id uuid references public.shopping_list_items (id) on delete set null,
  add column buyer_member_id uuid references public.members (id) on delete set null,
  alter column status set default 'PENDING';

create index purchase_session_items_shopping_list_item_idx
  on public.purchase_session_items (shopping_list_item_id)
  where shopping_list_item_id is not null;

-- Cosmetic: keep index / trigger names in step with the tables.
alter index receipt_import_sessions_household_id_idx rename to purchase_sessions_household_id_idx;
alter index receipt_import_items_session_id_idx rename to purchase_session_items_session_id_idx;
alter trigger receipt_import_sessions_set_updated_at on public.purchase_sessions
  rename to purchase_sessions_set_updated_at;
alter trigger receipt_import_items_set_updated_at on public.purchase_session_items
  rename to purchase_session_items_set_updated_at;

-- =========================================================================
-- RLS -- drop + recreate the six policies so their names and their
-- cross-table references read as purchase_* (the underlying behaviour is
-- unchanged: permissive member CRUD, no delete policy -- the wizard's
-- "delete draft order" goes through the service_role path).
-- =========================================================================

drop policy receipt_import_sessions_select on public.purchase_sessions;
drop policy receipt_import_sessions_insert on public.purchase_sessions;
drop policy receipt_import_sessions_update on public.purchase_sessions;
drop policy receipt_import_items_select on public.purchase_session_items;
drop policy receipt_import_items_insert on public.purchase_session_items;
drop policy receipt_import_items_update on public.purchase_session_items;

create policy purchase_sessions_select on public.purchase_sessions
  for select using (public.is_household_member(household_id));
create policy purchase_sessions_insert on public.purchase_sessions
  for insert with check (public.is_household_member(household_id));
create policy purchase_sessions_update on public.purchase_sessions
  for update using (public.is_household_member(household_id));

create policy purchase_session_items_select on public.purchase_session_items
  for select using (
    exists (
      select 1 from public.purchase_sessions s
      where s.id = session_id and public.is_household_member(s.household_id)
    )
  );
create policy purchase_session_items_insert on public.purchase_session_items
  for insert with check (
    exists (
      select 1 from public.purchase_sessions s
      where s.id = session_id and public.is_household_member(s.household_id)
    )
  );
create policy purchase_session_items_update on public.purchase_session_items
  for update using (
    exists (
      select 1 from public.purchase_sessions s
      where s.id = session_id and public.is_household_member(s.household_id)
    )
  );
