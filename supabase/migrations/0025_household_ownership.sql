-- Households gain a real, transferable "owner" concept instead of a frozen
-- "creator" -- the column is renamed (same type/nullability/ON DELETE
-- RESTRICT against public.users) since a household's original creator is,
-- for every existing row, also its only-ever admin: exactly what "current
-- owner" already means for a row that's never had a transfer happen. No
-- data backfill needed.
--
-- Owning a household is what should block a user from deleting their own
-- account (see delete_own_account in app/services/users.py) -- RESTRICT is
-- the correct enforcement for that guarantee, not SET NULL.

alter table public.households rename column created_by_user_id to owner_id;

-- Same check as before, just the renamed column -- unauthenticated bootstrap
-- insert still requires naming yourself owner of the household you're
-- creating.
alter policy households_insert on public.households
  with check (owner_id = auth.uid());

-- Same bootstrap branch as before ("insert yourself as first member of a
-- household you just created"), just the renamed column.
alter policy members_insert on public.members
  with check (
    (
      user_id = auth.uid()
      and exists (
        select 1 from public.households h
        where h.id = household_id and h.owner_id = auth.uid()
      )
    )
    or public.is_household_admin(household_id)
  );

create or replace function public.create_household_and_join(
  p_user_id uuid,
  p_name text,
  p_address text,
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
  insert into public.households (name, address, owner_id)
    values (p_name, p_address, p_user_id)
    returning * into h;

  insert into public.members (household_id, user_id, nickname, is_admin)
    values (h.id, p_user_id, p_nickname, true);

  return h;
end;
$$;
