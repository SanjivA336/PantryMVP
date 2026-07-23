-- Food categories, for color-coding foods in the UI. Replaces the unused
-- free-text `food_group` column with a proper enum, precisely re-tagging
-- every existing row by name (not by old food_group, since the old
-- `produce`/`frozen`/`pantry` tags each split across multiple new
-- categories and can't be remapped by a simple group->group lookup).

create type public.food_category as enum (
  'PROTEINS',
  'VEGETABLES_HERBS',
  'FRUITS',
  'GRAINS_BREADS',
  'DAIRY_ALTERNATIVES',
  'SEASONINGS_SPICES',
  'OILS_FATS',
  'SAUCES_CONDIMENTS',
  'SNACKS_SWEETS',
  'BEVERAGES',
  'OTHER'
);

alter table public.global_food_definitions
  add column category public.food_category;

-- Precise per-food backfill for the 90 seeded foods. Any row whose name
-- doesn't match (a household's own user-created food, e.g. from testing)
-- falls through to OTHER via the else clause, rather than being left null.
update public.global_food_definitions
set category = case name
  -- Dairy & Dairy Alternatives
  when 'Whole Milk' then 'DAIRY_ALTERNATIVES'
  when '2% Milk' then 'DAIRY_ALTERNATIVES'
  when 'Skim Milk' then 'DAIRY_ALTERNATIVES'
  when 'Oat Milk' then 'DAIRY_ALTERNATIVES'
  when 'Almond Milk' then 'DAIRY_ALTERNATIVES'
  when 'Butter' then 'DAIRY_ALTERNATIVES'
  when 'Cheddar Cheese' then 'DAIRY_ALTERNATIVES'
  when 'Mozzarella Cheese' then 'DAIRY_ALTERNATIVES'
  when 'Parmesan Cheese' then 'DAIRY_ALTERNATIVES'
  when 'Cream Cheese' then 'DAIRY_ALTERNATIVES'
  when 'Greek Yogurt' then 'DAIRY_ALTERNATIVES'
  when 'Sour Cream' then 'DAIRY_ALTERNATIVES'
  -- Proteins
  when 'Eggs Large' then 'PROTEINS'
  when 'Chicken Breast' then 'PROTEINS'
  when 'Chicken Thighs' then 'PROTEINS'
  when 'Ground Beef' then 'PROTEINS'
  when 'Ground Turkey' then 'PROTEINS'
  when 'Bacon' then 'PROTEINS'
  when 'Salmon Fillet' then 'PROTEINS'
  when 'Shrimp' then 'PROTEINS'
  when 'Tofu' then 'PROTEINS'
  when 'Black Beans (Canned)' then 'PROTEINS'
  when 'Chickpeas (Canned)' then 'PROTEINS'
  when 'Peanut Butter' then 'PROTEINS'
  -- Oils & Fats
  when 'Olive Oil' then 'OILS_FATS'
  when 'Vegetable Oil' then 'OILS_FATS'
  when 'Canola Oil' then 'OILS_FATS'
  when 'Sesame Oil' then 'OILS_FATS'
  -- Seasonings & Spices
  when 'Salt' then 'SEASONINGS_SPICES'
  when 'Black Pepper' then 'SEASONINGS_SPICES'
  when 'Garlic Powder' then 'SEASONINGS_SPICES'
  when 'Paprika' then 'SEASONINGS_SPICES'
  when 'Cumin' then 'SEASONINGS_SPICES'
  when 'Cinnamon' then 'SEASONINGS_SPICES'
  when 'Red Pepper Flakes' then 'SEASONINGS_SPICES'
  -- Grains & Breads
  when 'Bread (White)' then 'GRAINS_BREADS'
  when 'Whole Wheat Bread' then 'GRAINS_BREADS'
  when 'White Rice' then 'GRAINS_BREADS'
  when 'Brown Rice' then 'GRAINS_BREADS'
  when 'Pasta (Spaghetti)' then 'GRAINS_BREADS'
  when 'Penne Pasta' then 'GRAINS_BREADS'
  when 'Quinoa' then 'GRAINS_BREADS'
  when 'Rolled Oats' then 'GRAINS_BREADS'
  when 'All-Purpose Flour' then 'GRAINS_BREADS'
  when 'Tortillas (Flour)' then 'GRAINS_BREADS'
  -- Fruits (old `produce` tag, fruit half)
  when 'Apples' then 'FRUITS'
  when 'Bananas' then 'FRUITS'
  when 'Oranges' then 'FRUITS'
  when 'Strawberries' then 'FRUITS'
  when 'Blueberries' then 'FRUITS'
  when 'Avocado' then 'FRUITS'
  when 'Lemons' then 'FRUITS'
  when 'Limes' then 'FRUITS'
  -- Vegetables & Herbs (old `produce` tag, vegetable half)
  when 'Tomatoes' then 'VEGETABLES_HERBS'
  when 'Onions (Yellow)' then 'VEGETABLES_HERBS'
  when 'Garlic' then 'VEGETABLES_HERBS'
  when 'Potatoes (Russet)' then 'VEGETABLES_HERBS'
  when 'Sweet Potatoes' then 'VEGETABLES_HERBS'
  when 'Carrots' then 'VEGETABLES_HERBS'
  when 'Celery' then 'VEGETABLES_HERBS'
  when 'Bell Peppers' then 'VEGETABLES_HERBS'
  when 'Broccoli' then 'VEGETABLES_HERBS'
  when 'Spinach' then 'VEGETABLES_HERBS'
  when 'Lettuce (Romaine)' then 'VEGETABLES_HERBS'
  when 'Cucumber' then 'VEGETABLES_HERBS'
  when 'Mushrooms' then 'VEGETABLES_HERBS'
  -- Sauces & Condiments (old `condiments` tag)
  when 'Ketchup' then 'SAUCES_CONDIMENTS'
  when 'Mustard' then 'SAUCES_CONDIMENTS'
  when 'Mayonnaise' then 'SAUCES_CONDIMENTS'
  when 'Soy Sauce' then 'SAUCES_CONDIMENTS'
  when 'Hot Sauce' then 'SAUCES_CONDIMENTS'
  when 'BBQ Sauce' then 'SAUCES_CONDIMENTS'
  when 'Honey' then 'SAUCES_CONDIMENTS'
  when 'Maple Syrup' then 'SAUCES_CONDIMENTS'
  -- Beverages
  when 'Orange Juice' then 'BEVERAGES'
  when 'Coffee (Ground)' then 'BEVERAGES'
  when 'Tea Bags' then 'BEVERAGES'
  when 'Sparkling Water' then 'BEVERAGES'
  when 'Beer' then 'BEVERAGES'
  -- Old `frozen` tag: storage state doesn't define category, so this
  -- splits by what the food fundamentally is, not how it's stored.
  when 'Ice Cream' then 'SNACKS_SWEETS'
  when 'Frozen Peas' then 'VEGETABLES_HERBS'
  when 'Frozen Corn' then 'VEGETABLES_HERBS'
  when 'Frozen Pizza' then 'OTHER'
  -- Old `supplements` tag
  when 'Protein Powder' then 'OTHER'
  -- Snacks & Sweets (old `snacks` tag)
  when 'Granola Bars' then 'SNACKS_SWEETS'
  when 'Potato Chips' then 'SNACKS_SWEETS'
  when 'Crackers' then 'SNACKS_SWEETS'
  -- Old `pantry` tag: preserved tomatoes are still fundamentally tomatoes;
  -- broths are multi-ingredient manufactured products, not a raw food.
  when 'Canned Tomatoes' then 'VEGETABLES_HERBS'
  when 'Chicken Broth' then 'OTHER'
  when 'Vegetable Broth' then 'OTHER'
  else 'OTHER'
end::public.food_category;

alter table public.global_food_definitions
  alter column category set default 'OTHER',
  alter column category set not null;

alter table public.global_food_definitions
  drop column food_group;
