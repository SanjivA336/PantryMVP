-- Closes the direct-write holes found in the 2026-10-05 security review.
--
-- The frontend ships the public anon key and every logged-in user holds a JWT,
-- so any user can call PostgREST (/rest/v1/...) directly and skip FastAPI. RLS
-- policies only filter ROWS, never columns or "who is named in the row", so
-- several policies let a member write things FastAPI would have refused:
--   * members_update      -> a member could set their own is_admin / is_active
--   * households_update   -> an admin could rewrite owner_id / join_code
--   * consumption_events, inventory_items, purchase_events, purchase_corrections
--     -> a member could forge usage or cost against a roommate, or edit a
--        settled item, bypassing the freeze and the correction flow
--
-- Nothing legitimate needs those writes: FastAPI writes with the service-role
-- key (which ignores both RLS and these privileges) and the SECURITY DEFINER
-- RPCs run as their owner. The frontend only uses PostgREST for realtime
-- (SELECT) and for Storage uploads (a different schema). So this takes
-- ordinary users' write access away from every public table. Postgres checks
-- privileges before RLS, so this closes the door for every column at once,
-- and for tables added later (see the default-privileges line).
--
-- 0009 and 0027 already did this for ledger_entries, household_activity and
-- settlement_records. SELECT is untouched, so reads and realtime still work.

revoke insert, update, delete, truncate on all tables in schema public
  from anon, authenticated;

-- Tables created after this migration should not start out writable by clients.
alter default privileges in schema public
  revoke insert, update, delete, truncate on tables from anon, authenticated;

-- A removed member could rejoin with the (static) join code and keep the admin
-- flag they had when they were removed, because the upsert only reactivated the
-- row. Rejoining after removal now always comes back as a regular member. An
-- active member calling join again is unchanged (their role stays).
create or replace function public.join_household_by_code(
  p_user_id uuid,
  p_join_code text,
  p_nickname text
)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
begin
  select * into h from public.households where join_code = p_join_code;

  if h.id is null then
    raise exception 'INVALID_JOIN_CODE';
  end if;

  insert into public.members (household_id, user_id, nickname)
    values (h.id, p_user_id, p_nickname)
  on conflict (household_id, user_id) where user_id is not null do update
    set is_active = true,
        nickname = excluded.nickname,
        is_admin = case when public.members.is_active then public.members.is_admin else false end;

  return h;
end;
$$;
