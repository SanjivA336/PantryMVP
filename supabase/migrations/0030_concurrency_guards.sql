-- Two concurrency guards for the live-until-frozen debt model.
--
-- The whole point of debt_frozen_at being null is that while an item is
-- live, its cost / quantity / roster are freely editable and every
-- member's share is recomputed live from current usage. Nothing is posted
-- to ledger_entries until the item's story ends (freeze_item_debt). Two
-- races undermine that:
--
-- A. Roster edits (inventory_item_allowed_members) were a non-atomic
--    delete-all + re-insert + update split_member_count, run as three
--    separate PostgREST calls from services/inventory_items.py. Two
--    concurrent roster edits could interleave into a union/partial roster,
--    and freeze_item_debt reading the roster mid-swap could split the
--    final bill against a partial set. set_inventory_item_roster does the
--    whole swap in one transaction under a row lock on the item.
--
-- B. correct_item (POST .../corrections, for already-frozen items) reads a
--    baseline cost/quantity, computes a delta, and posts ADJUSTMENT
--    ledger_entries for it. Two concurrent corrections both read the same
--    baseline and both post their delta -- the ledger ends up adjusted by
--    the sum while the item only moved once. The fix is a compare-and-swap
--    on the item row in Python (mirrors freeze_item_debt's CAS on
--    debt_frozen_at); this migration only adds the index that CAS leans
--    on.

-- =========================================================================
-- A. Atomic roster swap
-- =========================================================================

create or replace function public.set_inventory_item_roster(
  p_household_id uuid,
  p_item_id uuid,
  p_member_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
begin
  -- Row lock for the duration: serializes concurrent roster edits, and
  -- makes the delete+insert below atomic relative to anything reading the
  -- roster (freeze_item_debt does plain SELECTs, so under READ COMMITTED
  -- it sees the whole old roster or the whole new one, never a partial).
  select * into v_item
  from public.inventory_items
  where id = p_item_id and household_id = p_household_id
  for update;

  if v_item.id is null then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  -- The API already gates this; belt-and-suspenders here because a frozen
  -- non-PERSONAL item's real ledger_entries were split against
  -- split_member_count and must stay consistent with it.
  if v_item.debt_frozen_at is not null and v_item.accounting_type <> 'PERSONAL' then
    raise exception 'ITEM_FROZEN';
  end if;

  if coalesce(array_length(p_member_ids, 1), 0) = 0 then
    raise exception 'ITEM_MUST_HAVE_ALLOWED_MEMBERS';
  end if;

  delete from public.inventory_item_allowed_members
    where inventory_item_id = p_item_id;

  insert into public.inventory_item_allowed_members (inventory_item_id, member_id)
    select p_item_id, unnest(p_member_ids);

  -- split_member_count only tracks the roster for non-PERSONAL items (it's
  -- null for PERSONAL, enforced by inventory_items_split_count_check).
  if v_item.accounting_type <> 'PERSONAL' then
    update public.inventory_items
      set split_member_count = array_length(p_member_ids, 1)
      where id = p_item_id;
  end if;
end;
$$;

revoke execute on function public.set_inventory_item_roster(uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.set_inventory_item_roster(uuid, uuid, uuid[])
  to service_role;

-- =========================================================================
-- B. correction CAS support -- correct_item claims the item row with an
--    `.eq("updated_at", <baseline>)` conditional update before posting any
--    purchase_corrections row or ADJUSTMENT entry. This index just keeps
--    that per-row lookup cheap.
-- =========================================================================

create index if not exists inventory_items_id_updated_at_idx
  on public.inventory_items (id, updated_at);
