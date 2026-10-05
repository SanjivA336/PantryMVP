-- Lets an admin replace a burrow's join code on demand (the "Make a new code"
-- button in Settings). The code is otherwise fixed for the life of the burrow,
-- so there was no way to stop someone who had been removed but still knew it
-- from rejoining.
--
-- The new code comes from generate_join_code(), the same generator the original
-- code used: same alphabet, same 8-character format, and it keeps drawing until
-- the code isn't already taken by another burrow. join_household_by_code looks
-- the code up by value, so the old code stops working the moment this commits.
--
-- generate_join_code() checks for a free code and the UPDATE then writes it as
-- two steps, so two simultaneous regenerations could in theory draw the same
-- free code. households.join_code is UNIQUE, so the loser gets a unique
-- violation instead of a duplicate; we just draw again (a few tries at most).
--
-- Who may call this (admins and the owner) is decided by FastAPI, like every
-- other write. The function itself is service-role only, never client-callable.

create or replace function public.regenerate_join_code(p_household_id uuid)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
  attempts int := 0;
begin
  loop
    begin
      update public.households
        set join_code = public.generate_join_code()
        where id = p_household_id
        returning * into h;
      exit;
    exception when unique_violation then
      attempts := attempts + 1;
      if attempts >= 5 then
        raise;
      end if;
    end;
  end loop;

  if h.id is null then
    raise exception 'HOUSEHOLD_NOT_FOUND';
  end if;

  return h;
end;
$$;

revoke execute on function public.regenerate_join_code(uuid) from public, anon, authenticated;
grant execute on function public.regenerate_join_code(uuid) to service_role;
