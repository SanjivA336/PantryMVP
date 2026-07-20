-- Phase 2c: live updates across devices/tabs. Supabase's Postgres Changes
-- feature (supabase-js's `.channel(...).on('postgres_changes', ...)`) only
-- streams changes for tables explicitly added to the `supabase_realtime`
-- publication, and — since RLS is enabled on both tables below — only rows
-- each connected user's own RLS SELECT policy (is_household_member) would
-- let them see anyway. No new policies needed; this just turns the stream on.
alter publication supabase_realtime add table public.inventory_items;
alter publication supabase_realtime add table public.ledger_entries;
