import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { RecipeDetail } from '../../types/entities'
import { RecipeForm, type RecipeFormInitial, type RecipeSubmitBody } from './RecipeForm'

function recipeDetailToFormInitial(recipe: RecipeDetail): RecipeFormInitial {
  return {
    name: recipe.name,
    description: recipe.description,
    servings: recipe.servings,
    prep_time_minutes: recipe.prep_time_minutes,
    cook_time_minutes: recipe.cook_time_minutes,
    instructions: recipe.instructions,
    ingredients: recipe.ingredients.map((ing) => ({
      food: { id: ing.global_food_definition_id, name: ing.food_name },
      quantity: ing.quantity,
      unit: ing.unit,
      note: ing.note ?? '',
    })),
  }
}

export function EditRecipePage() {
  const { householdId, recipeId } = useParams<{ householdId: string; recipeId: string }>()
  const navigate = useNavigate()
  const {
    data: recipe,
    loading,
    error,
  } = useHouseholdResource<RecipeDetail>(
    householdId && recipeId ? `/api/households/${householdId}/recipes/${recipeId}` : null,
  )

  const onSubmit = async (body: RecipeSubmitBody) => {
    await apiClient.patch<RecipeDetail>(`/api/households/${householdId}/recipes/${recipeId}`, body)
    navigate(`/households/${householdId}/recipes/${recipeId}`)
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>
  if (error || !recipe) return <p className="text-sm text-danger">{error ?? 'Recipe not found'}</p>

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-4 text-xl font-semibold">Edit recipe</h2>
      <RecipeForm
        initial={recipeDetailToFormInitial(recipe)}
        submitLabel="Save changes"
        onSubmit={onSubmit}
      />
    </div>
  )
}
