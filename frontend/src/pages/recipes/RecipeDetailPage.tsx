import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { RecipeDetail, RecipeIngredient } from '../../types/entities'

function scaledQuantityLabel(ingredient: RecipeIngredient, scale: number): string {
  const scaled = Number(ingredient.quantity) * scale
  // Trim trailing zeros from the multiplication without ever showing more
  // than 2 decimal places (scaling e.g. 1/3 servings can produce long
  // floats that aren't meaningful at kitchen-measurement precision).
  const rounded = Math.round(scaled * 100) / 100
  return `${rounded} ${ingredient.unit}`
}

function AvailabilityBadge({ ingredient, scale }: { ingredient: RecipeIngredient; scale: number }) {
  if (!ingredient.available) {
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        Missing
      </span>
    )
  }
  if (ingredient.available_quantity !== null) {
    const needed = Number(ingredient.quantity) * scale
    const onHand = Number(ingredient.available_quantity)
    if (onHand < needed) {
      return (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
          Not quite enough ({onHand} {ingredient.unit} on hand)
        </span>
      )
    }
  }
  return (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
      In stock
    </span>
  )
}

export function RecipeDetailPage() {
  const { householdId, recipeId } = useParams<{ householdId: string; recipeId: string }>()
  const navigate = useNavigate()
  const {
    data: recipe,
    loading,
    error,
  } = useHouseholdResource<RecipeDetail>(
    householdId && recipeId ? `/api/households/${householdId}/recipes/${recipeId}` : null,
  )
  const [servings, setServings] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    if (recipe) setServings(recipe.servings)
  }, [recipe])

  const deleteRecipe = async () => {
    setActionError(null)
    try {
      await apiClient.delete(`/api/households/${householdId}/recipes/${recipeId}`)
      navigate(`/households/${householdId}/recipes`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  if (loading) return <p className="text-sm">Loading…</p>
  if (error || !recipe) return <p className="text-sm text-red-600">{error ?? 'Recipe not found'}</p>

  const scale = servings && recipe.servings ? servings / recipe.servings : 1

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{recipe.name}</h2>
          {recipe.description && <p className="text-sm text-gray-500">{recipe.description}</p>}
          <p className="mt-1 text-xs text-gray-400">
            {recipe.prep_time_minutes != null && <>Prep {recipe.prep_time_minutes}m </>}
            {recipe.cook_time_minutes != null && <>Cook {recipe.cook_time_minutes}m</>}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            to={`/households/${householdId}/recipes/${recipeId}/edit`}
            className="text-gray-600 hover:underline"
          >
            Edit
          </Link>
          <button type="button" onClick={deleteRecipe} className="text-red-600 hover:underline">
            Delete
          </button>
        </div>
      </div>

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Servings</label>
        <input
          type="number"
          min={1}
          className="w-20 rounded-md border border-gray-300 px-2 py-1"
          value={servings ?? recipe.servings}
          onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))}
        />
        <span className="text-xs text-gray-400">(recipe as written: {recipe.servings})</span>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-500">Ingredients</h3>
        <ul className="flex flex-col gap-2">
          {recipe.ingredients.map((ingredient) => (
            <li
              key={ingredient.id}
              className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3"
            >
              <div>
                <span className="font-medium">{ingredient.food_name}</span>
                <span className="ml-2 text-sm text-gray-500">
                  {scaledQuantityLabel(ingredient, scale)}
                </span>
                {ingredient.note && (
                  <span className="ml-2 text-xs text-gray-400">({ingredient.note})</span>
                )}
              </div>
              <AvailabilityBadge ingredient={ingredient} scale={scale} />
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-gray-500">Instructions</h3>
        <ol className="flex flex-col gap-2 text-sm">
          {recipe.instructions.map((step, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-gray-400">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
