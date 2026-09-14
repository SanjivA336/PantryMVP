-- Drop the allowed_member_ids gate on logging usage. Previously
-- consume_inventory_item rejected any member not on the item's allowed
-- list outright (MEMBER_NOT_ALLOWED) -- but allowed_member_ids is really
-- about who the *cost* is split between, not a hard rule about who's
-- physically permitted to eat something (the buyer can always say "sure,
-- go ahead" to someone outside that list, and still wants it logged for
-- accurate remaining-quantity tracking). Any active member of the
-- household can now log usage on any item in it; the accounting-side
-- handling of usage from someone outside allowed_member_ids (billed
-- directly for exactly what they used, the same way any overage already
-- is) lives in app/services/accounting.py's _bill_outsiders.
--
-- The caller is still required to be an active member of *this household*
-- -- that check happens in the Python layer (require_household_membership)
-- before this RPC is ever invoked, so nothing here needs to re-verify it.

create or replace function public.consume_inventory_item(
  p_household_id uuid,
  p_member_id uuid,
  p_inventory_item_id uuid,
  p_quantity_used numeric
)
returns public.inventory_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.inventory_items;
begin
  update public.inventory_items
    set quantity = quantity - p_quantity_used
    where id = p_inventory_item_id
      and household_id = p_household_id
      and status = 'ACTIVE'
      and quantity >= p_quantity_used
    returning * into v_item;

  if v_item.id is null then
    raise exception 'INSUFFICIENT_QUANTITY';
  end if;

  insert into public.consumption_events (household_id, member_id, inventory_item_id, quantity_used)
    values (p_household_id, p_member_id, p_inventory_item_id, p_quantity_used);

  return v_item;
end;
$$;
