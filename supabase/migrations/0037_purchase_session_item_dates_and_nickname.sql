-- The purchase wizard's per-line editor never offered expiry_date,
-- best_by_date, or a nickname (name_override) -- CreateInventoryItemRequest
-- (and the Add Item page) has always supported all three, but a line
-- finalized through the wizard just never had anywhere to put them. Adding
-- the columns here lets update_item/finalize (app/services/purchase_sessions.py)
-- carry them straight through to the real inventory_items row, the same way
-- quantity/cost/storage_location_id already do.

alter table public.purchase_session_items
  add column expiry_date date,
  add column best_by_date date,
  add column name_override text;
