import type { DraftRecipe } from '../../types/entities'
import type { RecipeFormInitial } from './RecipeForm'

export function draftRecipeToFormInitial(draft: DraftRecipe): RecipeFormInitial {
  return {
    name: draft.name,
    description: draft.description,
    servings: draft.servings,
    prep_time_minutes: draft.prep_time_minutes,
    cook_time_minutes: draft.cook_time_minutes,
    instructions: draft.instructions.length > 0 ? draft.instructions : [''],
    ingredients: draft.ingredients.map((ing) => ({
      // The AI never resolves a real food id -- the human always picks the
      // real catalog food via FoodSearchInput, same as receipt-import lines.
      food: null,
      quantity: ing.quantity ?? '',
      unit: ing.unit ?? '',
      note: ing.note ?? '',
      suggestedName: ing.name,
    })),
  }
}
