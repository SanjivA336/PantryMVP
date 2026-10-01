-- Terms/Privacy acceptance, enforced and recorded at signup.
--
-- Signup goes straight from the browser to Supabase Auth, so the signup form's
-- checkboxes can be bypassed by anyone calling the Auth API directly. This
-- migration moves the rule into the database: no auth.users row can be created
-- unless the signup request claims a Terms/Privacy version
-- (options.data.accepted_terms_version), and the acceptance is stored on
-- public.users with a server-side timestamp.
--
-- What this does and doesn't prove: the version string comes from the client,
-- so it is a recorded *claim* that the signup request accepted the terms, not
-- proof the person read them. That is the same strength of evidence as any
-- checkbox-on-a-form, but it guarantees every new account has a record.
--
-- Columns are nullable on purpose: accounts created before this migration have
-- no record (NULL), which is also exactly what a future "please re-accept the
-- updated terms" check needs to find them.

alter table public.users
  add column terms_version text,
  add column terms_accepted_at timestamptz;

-- The version is stamped by the server (now()), never trusted from the client,
-- and length-limited so the field can't be used to stash junk. public.users has
-- no insert/update policy, so nothing but this trigger can ever write it.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, terms_version, terms_accepted_at)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'accepted_terms_version',
    now()
  );
  return new;
end;
$$;

-- BEFORE INSERT so that raising here aborts the whole signup: no auth.users
-- row, no public.users row, no confirmation email.
create or replace function public.require_terms_acceptance()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  accepted_version text := new.raw_user_meta_data ->> 'accepted_terms_version';
begin
  if accepted_version is null or char_length(btrim(accepted_version)) not between 1 and 32 then
    raise exception 'You must accept the Terms of Service and Privacy Policy to create an account.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger require_terms_acceptance
  before insert on auth.users
  for each row execute function public.require_terms_acceptance();
