-- A short human-readable descriptor for ADJUSTMENT ledger entries.
--
-- ADJUSTMENT rows (posted when a cost or usage correction lands after an
-- item's debt has already frozen -- see correct_item/_post_usage_correction_
-- adjustments in services/inventory_items.py) deliberately carry neither
-- source_purchase_event_id nor source_consumption_event_id (see the check
-- constraint from migration 0009), so the existing food-name join that
-- PURCHASE/OVERAGE entries get has nothing to resolve for them -- they've
-- always shown up in the UI as a bare "Adjustment" with no further context.
--
-- Rather than relaxing that check constraint to attach a source event (which
-- would blur "this entry came from a real purchase/consumption" with "this
-- is a correction to one"), just record the one-line reason directly: e.g.
-- "Cost correction on Whole Milk". Nullable and additive -- existing rows
-- read as null, existing queries are untouched.

alter table public.ledger_entries
  add column note text;
