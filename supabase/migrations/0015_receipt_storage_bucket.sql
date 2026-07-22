-- Phase 6: Supabase Storage bucket for receipt photos, plus RLS on
-- storage.objects gated by household membership via a path-encoded
-- household_id ("{household_id}/{session_id}.{ext}").
--
-- public MUST stay false -- if this bucket were public, every RLS policy
-- below would be decorative, since anyone with a guessed/leaked object URL
-- could read it regardless of policy. Verify after push:
--   select public from storage.buckets where id = 'receipt-images';
-- must return false.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'receipt-images',
  'receipt-images',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Reuses the existing is_household_member() SECURITY DEFINER helper --
-- it only depends on auth.uid(), so it works fine called from a
-- storage.objects policy despite living in a different logical area.
--
-- Both INSERT and SELECT are required: Storage has no implicit owner-read,
-- so a SELECT-less bucket would mean even the legitimate uploader couldn't
-- read back their own object (needed for the review page to show the
-- original photo). No UPDATE policy (objects are write-once per session
-- id -- a redo uploads under a new session id). No DELETE policy for
-- authenticated this phase -- orphaned objects on household deletion are
-- an accepted, deliberate gap for now (no FK relationship exists between
-- households and Storage objects), matching this phase's low-priority
-- framing; a cleanup job can address it later if this feature sees real use.

create policy receipt_images_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'receipt-images'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );

create policy receipt_images_select on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'receipt-images'
    and public.is_household_member((storage.foldername(name))[1]::uuid)
  );
