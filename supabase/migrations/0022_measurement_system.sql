-- Household-level default measurement system (metric/customary), plus a
-- per-(household, food) dimension + system choice that's remembered once
-- someone adds that food using it. Deliberately additive and experimental:
-- inventory_items.preferred_unit stays exactly as-is (free text, unchanged
-- storage), these are new nullable "what should the *next* item for this
-- food default to" hints layered on top -- easy to drop if this approach
-- doesn't work out.
--
-- Weight<->volume conversion needs a food's density, which this app
-- deliberately doesn't ask users for -- so a food is tracked in exactly one
-- dimension (weight, volume, or count) per household at a time. Metric<->
-- customary within the same dimension is always an exact conversion (no
-- density needed), so that's freely switchable.

create type unit_system as enum ('METRIC', 'CUSTOMARY');
create type measurement_dimension as enum ('WEIGHT', 'VOLUME', 'COUNT');

alter table public.households
  add column preferred_unit_system unit_system not null default 'CUSTOMARY';

alter table public.household_food_variants
  add column dimension measurement_dimension,
  add column unit_system unit_system;

-- stock_warning_ignores was keyed on (household_id, household_food_variant_id)
-- alone, which assumed one active stock warning per variant. Once a variant
-- can have active stock split across dimensions (the "separate stock lines"
-- case), that's no longer true -- two different warnings for the same food
-- would collide on the same ignore row, and ignoring one would silently
-- clobber the other's ignore state. reference_unit disambiguates which
-- dimension's warning is being ignored.
alter table public.stock_warning_ignores
  drop constraint stock_warning_ignores_pkey,
  add column reference_unit text not null default '',
  add primary key (household_id, household_food_variant_id, reference_unit);

alter table public.stock_warning_ignores
  alter column reference_unit drop default;
