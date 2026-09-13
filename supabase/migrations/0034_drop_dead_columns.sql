-- Drop two columns that turned out to have no reader anywhere in the app.
--
-- global_food_definitions.common_substitutions: a manually-curated list of
-- substitute foods, distinct from the AI "suggest substitute" feature
-- (recipe_ai.py). Never surfaced in any UI (not on food creation, not on a
-- recipe ingredient) -- only ever populated by the one-time
-- scripts/seed_food_definitions.py loader. Superseded by the AI
-- substitution feature going forward.
--
-- storage_locations.description: settable via the add/edit storage
-- location form, but never displayed anywhere afterward -- write-only.

alter table public.global_food_definitions
  drop column if exists common_substitutions;

alter table public.storage_locations
  drop column if exists description;
