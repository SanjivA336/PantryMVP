-- Backs the seed script's ON CONFLICT (name) upsert, and doubles as a
-- minimal safeguard against literal duplicate names in the global catalog
-- (near-duplicates like "Whole Milk" vs "Whole Milk 1gal" are a separate
-- concern, handled via duplicate_of_id merging rather than this constraint).
create unique index global_food_definitions_name_unique
  on public.global_food_definitions (name);
