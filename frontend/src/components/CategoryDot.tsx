import { FOOD_CATEGORY_DOT_CLASSES, FOOD_CATEGORY_LABELS } from '../lib/foodCategories'
import type { FoodCategory } from '../types/entities'

// A small colored dot next to a food name -- `title` gives the category
// name on hover without needing a separate visible label everywhere.
export function CategoryDot({ category }: { category: FoodCategory | null }) {
  if (!category) return null
  return (
    <span
      title={FOOD_CATEGORY_LABELS[category]}
      className={`inline-block size-2 shrink-0 rounded-full ${FOOD_CATEGORY_DOT_CLASSES[category]}`}
    />
  )
}
