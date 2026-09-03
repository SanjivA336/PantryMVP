-- Consumption corrections: an append-only "I mis-logged that" fix.
--
-- consumption_events stays immutable -- the consumption_events_no_update
-- trigger is untouched. A correction is a NEW row with kind='CORRECTION'
-- and a signed quantity_used delta, pointing at the USAGE row it fixes.
-- _live_shares and freeze_item_debt already build usage_by_member by
-- SUMming quantity_used per member, so the signed delta nets in
-- automatically -- the billing math needs no changes.
--
-- inventory_items.quantity stays a maintained cache (the "Option 3"
-- choice): the consume RPC keeps decrementing it in one atomic statement,
-- and correct_consumption (services/inventory_items.py) recomputes it as
-- `current - delta` when a correction lands. Reads stay O(1); nothing
-- derives stock from a per-item event scan.

create type consumption_event_kind as enum ('USAGE', 'CORRECTION');

alter table public.consumption_events
  add column kind consumption_event_kind not null default 'USAGE',
  -- ON DELETE CASCADE: a correction without its original usage row is
  -- meaningless, and usage rows are only ever deleted by the household
  -- cascade anyway (the corrects_kind check below forbids nulling it).
  add column corrects_event_id uuid references public.consumption_events (id) on delete cascade,
  add column note text;

-- USAGE is still strictly positive. A CORRECTION is a signed delta
-- (negative to walk back an over-log, positive to add a missed one) and
-- must be non-zero. Widened to unconstrained numeric to match
-- inventory_items.quantity (migration 0028) -- base values scale up by the
-- unit factor and a fixed 3-decimal cap would quantize at rest.
alter table public.consumption_events
  drop constraint consumption_events_quantity_used_check;

alter table public.consumption_events
  alter column quantity_used type numeric;

alter table public.consumption_events
  add constraint consumption_events_quantity_used_check check (
    (kind = 'USAGE' and quantity_used > 0)
    or (kind = 'CORRECTION' and quantity_used <> 0)
  ),
  add constraint consumption_events_corrects_kind_check check (
    (kind = 'CORRECTION') = (corrects_event_id is not null)
  );

create index consumption_events_corrects_idx
  on public.consumption_events (corrects_event_id)
  where corrects_event_id is not null;
