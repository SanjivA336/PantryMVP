-- Phase 1: core foundation — users, households, members, storage locations.
-- Raw SQL is the single schema source of truth for this project (no ORM-owned migrations).

-- =========================================================================
-- Extensions & enums
-- =========================================================================

create extension if not exists pgcrypto;

create type storage_location_type as enum ('FRIDGE', 'FREEZER', 'PANTRY', 'GARDEN', 'OTHER');

-- =========================================================================
-- Shared trigger helper
-- =========================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================================
-- users — mirrors auth.users
-- =========================================================================

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- security definer + fixed search_path: this trigger fires as supabase_auth_admin,
-- which has no privileges on public.users otherwise, and an unfixed search_path
-- on a security definer function is a standard privilege-escalation footgun.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- =========================================================================
-- households
-- =========================================================================

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  join_code char(8) unique,
  created_by_user_id uuid not null references public.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Generated server-side (not in application code) so collision-checking is
-- atomic with the insert instead of racing a separate round-trip.
create or replace function public.generate_join_code()
returns text
language plpgsql
as $$
declare
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I, avoids visual ambiguity
  code text;
begin
  loop
    code := (
      select string_agg(substr(chars, (random() * length(chars))::int + 1, 1), '')
      from generate_series(1, 8)
    );
    exit when not exists (select 1 from public.households where join_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.set_join_code()
returns trigger
language plpgsql
as $$
begin
  if new.join_code is null then
    new.join_code := public.generate_join_code();
  end if;
  return new;
end;
$$;

create trigger households_set_join_code
  before insert on public.households
  for each row execute function public.set_join_code();

create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

-- =========================================================================
-- members
-- =========================================================================

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid references public.users (id) on delete set null,
  nickname text not null,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One membership row per user per household, ever (not filtered by is_active) —
-- rejoining reactivates the existing row rather than inserting a duplicate.
create unique index members_household_user_unique
  on public.members (household_id, user_id)
  where user_id is not null;

create index members_household_id_idx on public.members (household_id);
create index members_user_id_idx on public.members (user_id);

create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

-- =========================================================================
-- storage_locations
-- =========================================================================

create table public.storage_locations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null,
  type storage_location_type not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index storage_locations_household_id_idx on public.storage_locations (household_id);

create trigger storage_locations_set_updated_at
  before update on public.storage_locations
  for each row execute function public.set_updated_at();

-- =========================================================================
-- RLS helper functions
-- security definer + fixed search_path avoids self-referential recursion when
-- a policy on `members` would otherwise need to subquery `members` directly.
-- =========================================================================

create or replace function public.is_household_member(_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where household_id = _household_id
      and user_id = auth.uid()
      and is_active = true
  );
$$;

create or replace function public.is_household_admin(_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.members
    where household_id = _household_id
      and user_id = auth.uid()
      and is_admin = true
      and is_active = true
  );
$$;

-- =========================================================================
-- Bootstrap RPCs
--
-- supabase-py's .table() calls are independent PostgREST requests with no
-- shared transaction, so "create household, then insert first member" can't
-- safely be two sequential calls from FastAPI. These run as one transaction.
--
-- p_user_id is an explicit parameter (not auth.uid()) because FastAPI invokes
-- these under the service_role key, where auth.uid() is null. That is exactly
-- why EXECUTE must be revoked from anon/authenticated below — otherwise any
-- logged-in browser user could call the RPC directly via PostgREST and pass
-- an arbitrary p_user_id, impersonating someone else.
-- =========================================================================

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
  insert into public.households (name, address, created_by_user_id)
    values (p_name, p_address, p_user_id)
    returning * into h;

  insert into public.members (household_id, user_id, nickname, is_admin)
    values (h.id, p_user_id, p_nickname, true);

  return h;
end;
$$;

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
  on conflict (household_id, user_id) do update
    set is_active = true, nickname = excluded.nickname;

  return h;
end;
$$;

revoke execute on function public.create_household_and_join from public, anon, authenticated;
revoke execute on function public.join_household_by_code from public, anon, authenticated;
grant execute on function public.create_household_and_join to service_role;
grant execute on function public.join_household_by_code to service_role;

-- =========================================================================
-- Row-Level Security
-- =========================================================================

alter table public.users enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.storage_locations enable row level security;

-- users: read own row, or rows of people who share an active household with you.
-- No insert/update/delete policy — rows are only ever written by the auth trigger.
create policy users_select on public.users
  for select
  using (
    id = auth.uid()
    or id in (
      select user_id from public.members
      where household_id in (
        select household_id from public.members
        where user_id = auth.uid() and is_active = true
      )
    )
  );

-- households
create policy households_select on public.households
  for select
  using (public.is_household_member(id));

-- Bootstrap: anyone can create a household as long as they name themselves creator.
create policy households_insert on public.households
  for insert
  with check (created_by_user_id = auth.uid());

create policy households_update on public.households
  for update
  using (public.is_household_admin(id));

create policy households_delete on public.households
  for delete
  using (public.is_household_admin(id));

-- members
create policy members_select on public.members
  for select
  using (public.is_household_member(household_id));

create policy members_insert on public.members
  for insert
  with check (
    -- Bootstrap: a user inserting themself as the first member of a household
    -- they just created (no membership exists yet at this point).
    (
      user_id = auth.uid()
      and exists (
        select 1 from public.households h
        where h.id = household_id and h.created_by_user_id = auth.uid()
      )
    )
    -- Ongoing: an existing admin adding/reactivating a member.
    or public.is_household_admin(household_id)
  );

-- Note: RLS is row-level, so this cannot stop a non-admin from flipping their
-- own is_admin flag via a raw PATCH — that restriction is enforced in FastAPI,
-- which is the authoritative check for all writes regardless of RLS.
create policy members_update on public.members
  for update
  using (public.is_household_admin(household_id) or user_id = auth.uid())
  with check (public.is_household_admin(household_id) or user_id = auth.uid());

-- No members_delete policy: member removal is always a soft-deactivate (update),
-- never a row delete, from any app code path.

-- storage_locations: any active member can manage, no admin gate on any operation.
create policy storage_locations_select on public.storage_locations
  for select
  using (public.is_household_member(household_id));

create policy storage_locations_insert on public.storage_locations
  for insert
  with check (public.is_household_member(household_id));

create policy storage_locations_update on public.storage_locations
  for update
  using (public.is_household_member(household_id));

create policy storage_locations_delete on public.storage_locations
  for delete
  using (public.is_household_member(household_id));
