-- freeze_item_debt (see accounting.py) used to read the item's roster
-- (inventory_item_allowed_members) and consumption_events as plain,
-- unlocked SELECTs, compute each member's share in Python, and only then
-- claim the freeze with a compare-and-swap on debt_frozen_at. That leaves a
-- real gap: set_inventory_item_roster (migration 0030) takes its own row
-- lock and can swap the roster in between freeze's reads and its claim,
-- so the freeze prices the *old* roster and the edit never reaches the
-- ledger -- a silent lost edit, not a crash.
--
-- This folds the read + claim into one function that takes the same row
-- lock set_inventory_item_roster already takes. Whichever side acquires it
-- first now genuinely wins: a roster edit that lands first is what freeze
-- prices; a freeze that lands first sets debt_frozen_at before the roster
-- edit's own lock is granted, so that edit hits set_inventory_item_roster's
-- existing "already frozen" check and is cleanly rejected instead of
-- silently vanishing. consume_inventory_item's UPDATE already takes this
-- same row lock implicitly, so the usage side of the race was already
-- closed by construction (an item's status leaves ACTIVE, atomically,
-- before freeze_item_debt is ever called for it) -- only the roster side
-- needed this fix.
create or replace function public.claim_item_debt_freeze(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
  v_buyer_id uuid;
  v_member_ids uuid[];
  v_consumption jsonb;
begin
  select * into v_item
  from public.inventory_items
  where id = p_item_id
  for update;

  if v_item.id is null then
    return null;
  end if;

  -- PERSONAL items never touch the ledger and never freeze; an item
  -- someone else already froze is a no-op (idempotent, same as before --
  -- consume()/discard() can each call this for the same item under real
  -- concurrency).
  if v_item.debt_frozen_at is not null or v_item.accounting_type = 'PERSONAL' then
    return jsonb_build_object('already_frozen', true);
  end if;

  select member_id into v_buyer_id
  from public.purchase_events
  where id = v_item.purchase_event_id;

  select coalesce(array_agg(member_id), array[]::uuid[]) into v_member_ids
  from public.inventory_item_allowed_members
  where inventory_item_id = p_item_id;

  select coalesce(
    jsonb_agg(jsonb_build_object('member_id', member_id, 'quantity_used', quantity_used)),
    '[]'::jsonb
  ) into v_consumption
  from public.consumption_events
  where inventory_item_id = p_item_id;

  update public.inventory_items
    set debt_frozen_at = now()
    where id = p_item_id;

  return jsonb_build_object(
    'already_frozen', false,
    'household_id', v_item.household_id,
    'purchase_event_id', v_item.purchase_event_id,
    'buyer_id', v_buyer_id,
    'member_ids', to_jsonb(v_member_ids),
    'total_quantity', v_item.total_quantity,
    'cost', v_item.cost,
    'consumption', v_consumption
  );
end;
$$;

revoke execute on function public.claim_item_debt_freeze(uuid) from public, anon, authenticated;
grant execute on function public.claim_item_debt_freeze(uuid) to service_role;
