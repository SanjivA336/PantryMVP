-- Fixes join_household_by_code: `members_household_user_unique` is a partial
-- unique index (where user_id is not null), so Postgres can't infer it as the
-- ON CONFLICT arbiter unless the same predicate is repeated in the clause —
-- otherwise it fails with "no unique or exclusion constraint matching the ON
-- CONFLICT specification" (42P10).

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
    set is_active = true, nickname = excluded.nickname;

  return h;
end;
$$;
