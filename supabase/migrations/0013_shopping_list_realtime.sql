-- Live updates for the shopping list across devices, same mechanism as
-- migration 0011 (inventory_items, ledger_entries).
alter publication supabase_realtime add table public.shopping_list_items;
alter publication supabase_realtime add table public.shopping_list_sections;
