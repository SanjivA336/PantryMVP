import { z } from 'zod'

export const recipeSchema = z.object({
  name: z.string().min(1, 'Enter a recipe name'),
  description: z.string().optional(),
  servings: z.coerce.number().int().positive('Servings must be at least 1'),
  prep_time_minutes: z.coerce.number().int().min(0).optional(),
  cook_time_minutes: z.coerce.number().int().min(0).optional(),
})
// react-hook-form's raw state holds string inputs (z.input) before
// submission; the resolver transforms them to the coerced types (z.output)
// only at submit time -- same reasoning as the inventory add form's schema.
export type RecipeFormInput = z.input<typeof recipeSchema>
export type RecipeForm = z.output<typeof recipeSchema>
