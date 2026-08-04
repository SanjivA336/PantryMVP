-- Drops the GARDEN storage type. Gardens need their own tracking logic
-- (harvest dates instead of purchase/expiry, no "buy more" signal, etc.)
-- that this app doesn't have yet, and it's seen little real use -- not
-- worth the added complexity for now. Postgres can't drop a single enum
-- value in place, so this recreates the type without it.

update public.storage_locations set type = 'OTHER' where type = 'GARDEN';

create type storage_location_type_new as enum ('FRIDGE', 'FREEZER', 'PANTRY', 'OTHER');

alter table public.storage_locations
  alter column type type storage_location_type_new
  using type::text::storage_location_type_new;

drop type storage_location_type;
alter type storage_location_type_new rename to storage_location_type;
