-- A person's email address is now visible only to that person.
--
-- 0001 let anyone read the public.users row (which holds the email) of anyone
-- who shares an active household with them. That made co-members' emails
-- readable straight from the database API (/rest/v1/users) with just the public
-- key and a logged-in session, while the Privacy Policy tells people that other
-- members see their nickname. Nothing in the app needs it: the frontend never
-- reads this table (it uses the database API only for realtime and storage), and
-- the backend reads it with the service-role key, which ignores RLS. Members are
-- shown by nickname, from public.members.
--
-- Own-row access stays, so a person can still read their own account row.

drop policy if exists users_select on public.users;

create policy users_select on public.users
  for select
  using (id = auth.uid());
