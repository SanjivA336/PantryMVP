-- Resolves a real conflict surfaced by the integration test suite: Phase 1
-- requires household deletion to hard-cascade everything (an explicit,
-- deliberate decision), but the unconditional "no delete, ever" triggers on
-- purchase_events/consumption_events (added in 0004) blocked that cascade
-- entirely — a household with any purchase history could never be deleted.
--
-- Fix: drop the DELETE-blocking triggers, keep the UPDATE-blocking ones.
-- This doesn't reopen a tampering vector — nothing else can delete these
-- rows: there's no RLS delete policy on either table, and no API endpoint
-- deletes an individual purchase_event/consumption_event row directly. The
-- only remaining delete path is the already-approved full household wipe.
-- UPDATE tampering (quietly altering a historical amount) is the more
-- realistic threat, and stays fully blocked.

drop trigger if exists purchase_events_no_delete on public.purchase_events;
drop trigger if exists consumption_events_no_delete on public.consumption_events;
