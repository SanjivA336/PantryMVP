-- Fixes a real bug in 0009's consume_inventory_item: PL/pgSQL's
-- "WITH cte AS (...) SELECT ... INTO var FROM cte;" form does not reliably
-- attach the CTE to the SELECT it feeds when built this way -- confirmed by
-- an integration test failing with "relation \"slack\" does not exist" at
-- runtime (the CTE was silently dropped). Rewritten below to use a plain
-- LEFT JOIN against a grouped subquery instead of a correlated-subquery-
-- per-row CTE, for both the total-slack lookup and the INSERT ... SELECT --
-- avoids the WITH+INTO combination entirely rather than chasing the exact
-- parser edge case, and is a more efficient query shape besides (one grouped
-- aggregate instead of one correlated subquery per allowed member).
--
-- Same signature as 0009's version, so CREATE OR REPLACE genuinely replaces
-- it -- no DROP FUNCTION needed here (that's only required when the
-- parameter list changes).

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
  v_prior_used numeric;
  v_new_cumulative numeric;
  v_new_overage_qty numeric;
  v_allotment numeric;
  v_price_per_unit numeric;
  v_overage_cost numeric;
  v_total_slack numeric;
  v_new_event_id uuid;
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

  if not exists (
    select 1 from public.inventory_item_allowed_members
    where inventory_item_id = p_inventory_item_id and member_id = p_member_id
  ) then
    raise exception 'MEMBER_NOT_ALLOWED';
  end if;

  select coalesce(sum(quantity_used), 0) into v_prior_used
  from public.consumption_events
  where inventory_item_id = p_inventory_item_id and member_id = p_member_id;

  insert into public.consumption_events (household_id, member_id, inventory_item_id, quantity_used)
    values (p_household_id, p_member_id, p_inventory_item_id, p_quantity_used)
    returning id into v_new_event_id;

  if v_item.accounting_type = 'UNIT_BASED' and v_item.cost > 0 then
    v_allotment := v_item.total_quantity / v_item.split_member_count;
    v_price_per_unit := v_item.cost / v_item.total_quantity;
    v_new_cumulative := v_prior_used + p_quantity_used;
    v_new_overage_qty := greatest(v_new_cumulative - v_allotment, 0) - greatest(v_prior_used - v_allotment, 0);

    if v_new_overage_qty > 0 then
      v_overage_cost := v_new_overage_qty * v_price_per_unit;

      select coalesce(sum(greatest(v_allotment - coalesce(usage.total_used, 0), 0)), 0)
        into v_total_slack
      from public.inventory_item_allowed_members am
      left join (
        select member_id, sum(quantity_used) as total_used
        from public.consumption_events
        where inventory_item_id = p_inventory_item_id
        group by member_id
      ) usage on usage.member_id = am.member_id
      where am.inventory_item_id = p_inventory_item_id
        and am.member_id <> p_member_id;

      -- v_total_slack = 0 here should be unreachable: the physical-scarcity
      -- guard in the UPDATE above already ensures total overage can never
      -- exceed total slack across the item's lifetime. Left as a silent
      -- no-op rather than raising, defensively, rather than failing a
      -- consume request over a bookkeeping edge case.
      if v_total_slack > 0 then
        insert into public.ledger_entries
          (household_id, creditor_member_id, debtor_member_id, amount, reason, source_consumption_event_id)
        select p_household_id, s.member_id, p_member_id,
               v_overage_cost * s.slack_qty / v_total_slack,
               'OVERAGE', v_new_event_id
        from (
          select am.member_id,
                 greatest(v_allotment - coalesce(usage.total_used, 0), 0) as slack_qty
          from public.inventory_item_allowed_members am
          left join (
            select member_id, sum(quantity_used) as total_used
            from public.consumption_events
            where inventory_item_id = p_inventory_item_id
            group by member_id
          ) usage on usage.member_id = am.member_id
          where am.inventory_item_id = p_inventory_item_id
            and am.member_id <> p_member_id
        ) s
        where s.slack_qty > 0;
      end if;
    end if;
  end if;

  return v_item;
end;
$$;
