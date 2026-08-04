import type { FoodCategory } from '../types/entities'

// Single source of truth for category display name + color class, so the
// pairing isn't duplicated across every component that renders a food.
// Tailwind auto-generates `bg-category-*` from the --color-category-*
// tokens declared in index.css.
export const FOOD_CATEGORY_LABELS: Record<FoodCategory, string> = {
  PROTEINS: 'Proteins',
  VEGETABLES_HERBS: 'Vegetables & Herbs',
  FRUITS: 'Fruits',
  GRAINS_BREADS: 'Grains & Breads',
  DAIRY_ALTERNATIVES: 'Dairy & Dairy Alternatives',
  SEASONINGS_SPICES: 'Seasonings & Spices',
  OILS_FATS: 'Oils & Fats',
  SAUCES_CONDIMENTS: 'Sauces & Condiments',
  SNACKS_SWEETS: 'Snacks & Sweets',
  BEVERAGES: 'Beverages',
  OTHER: 'Other',
}

export const FOOD_CATEGORY_DOT_CLASSES: Record<FoodCategory, string> = {
  PROTEINS: 'bg-category-proteins',
  VEGETABLES_HERBS: 'bg-category-vegetables-herbs',
  FRUITS: 'bg-category-fruits',
  GRAINS_BREADS: 'bg-category-grains-breads',
  DAIRY_ALTERNATIVES: 'bg-category-dairy-alternatives',
  SEASONINGS_SPICES: 'bg-category-seasonings-spices',
  OILS_FATS: 'bg-category-oils-fats',
  SAUCES_CONDIMENTS: 'bg-category-sauces-condiments',
  SNACKS_SWEETS: 'bg-category-snacks-sweets',
  BEVERAGES: 'bg-category-beverages',
  OTHER: 'bg-category-other',
}

export const FOOD_CATEGORY_BORDER_CLASSES: Record<FoodCategory, string> = {
  PROTEINS: 'border-category-proteins',
  VEGETABLES_HERBS: 'border-category-vegetables-herbs',
  FRUITS: 'border-category-fruits',
  GRAINS_BREADS: 'border-category-grains-breads',
  DAIRY_ALTERNATIVES: 'border-category-dairy-alternatives',
  SEASONINGS_SPICES: 'border-category-seasonings-spices',
  OILS_FATS: 'border-category-oils-fats',
  SAUCES_CONDIMENTS: 'border-category-sauces-condiments',
  SNACKS_SWEETS: 'border-category-snacks-sweets',
  BEVERAGES: 'border-category-beverages',
  OTHER: 'border-category-other',
}

export const FOOD_CATEGORIES: FoodCategory[] = [
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
  'OTHER',
]
