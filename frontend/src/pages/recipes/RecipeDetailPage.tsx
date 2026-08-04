import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient, ApiError } from '../../lib/apiClient'
import { CategoryDot } from '../../components/CategoryDot'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { RecipeDetail, RecipeIngredient, SubstitutionSuggestion } from '../../types/entities'

// The backend allows up to ai_request_timeout_seconds (60s) for the
// initial call plus one repair retry on bad output -- worst case ~120s
// server-side. This must clear that with margin, or the client aborts and
// shows "timed out" for a request the backend would have finished.
const AI_TIMEOUT_MS = 130_000

type SubstitutionState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; suggestions: SubstitutionSuggestion[] }

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
      <span className="rounded-pill bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
        Missing
      </span>
    )
  }
  if (ingredient.available_quantity !== null) {
    const needed = Number(ingredient.quantity) * scale
    const onHand = Number(ingredient.available_quantity)
    if (onHand < needed) {
      return (
        <span className="rounded-pill bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
          Not quite enough ({onHand} {ingredient.unit} on hand)
        </span>
      )
    }
  }
  return (
    <span className="rounded-pill bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">
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
  const [substitutions, setSubstitutions] = useState<Record<string, SubstitutionState>>({})

  useEffect(() => {
    if (recipe) setServings(recipe.servings)
  }, [recipe])

  const suggestSubstitute = async (ingredient: RecipeIngredient) => {
    if (!recipe) return
    setSubstitutions((prev) => ({ ...prev, [ingredient.id]: { status: 'loading' } }))
    try {
      const otherNames = recipe.ingredients
        .filter((other) => other.id !== ingredient.id)
        .map((other) => other.food_name)
      const suggestions = await apiClient.post<SubstitutionSuggestion[]>(
        `/api/households/${householdId}/recipes/ai/substitutions`,
        {
          ingredient_name: ingredient.food_name,
          ingredient_quantity: ingredient.quantity,
          ingredient_unit: ingredient.unit,
          recipe_name: recipe.name,
          other_ingredient_names: otherNames,
        },
        { timeoutMs: AI_TIMEOUT_MS },
      )
      setSubstitutions((prev) => ({ ...prev, [ingredient.id]: { status: 'loaded', suggestions } }))
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Something went wrong'
      setSubstitutions((prev) => ({ ...prev, [ingredient.id]: { status: 'error', message } }))
    }
  }

  const deleteRecipe = async () => {
    setActionError(null)
    try {
      await apiClient.delete(`/api/households/${householdId}/recipes/${recipeId}`)
      navigate(`/households/${householdId}/recipes`)
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  if (loading) return <p className="text-sm text-muted">Loading…</p>
  if (error || !recipe) return <p className="text-sm text-danger">{error ?? 'Recipe not found'}</p>

  const scale = servings && recipe.servings ? servings / recipe.servings : 1

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">{recipe.name}</h2>
          {recipe.description && <p className="text-sm text-muted">{recipe.description}</p>}
          <p className="mt-1 text-xs text-faint">
            {recipe.prep_time_minutes != null && <>Prep {recipe.prep_time_minutes}m </>}
            {recipe.cook_time_minutes != null && <>Cook {recipe.cook_time_minutes}m</>}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link
            to={`/households/${householdId}/recipes/${recipeId}/edit`}
            className="text-muted hover:text-text hover:underline"
          >
            Edit
          </Link>
          <button
            type="button"
            onClick={deleteRecipe}
            className="text-danger hover:underline"
          >
            Delete
          </button>
        </div>
      </div>

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      <div className="flex items-center gap-2">
        <label className="text-sm font-medium text-muted">Servings</label>
        <input
          type="number"
          min={1}
          className="w-20 rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none focus:border-primary"
          value={servings ?? recipe.servings}
          onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))}
        />
        <span className="text-xs text-faint">(recipe as written: {recipe.servings})</span>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted">Ingredients</h3>
        <ul className="flex flex-col gap-2">
          {recipe.ingredients.map((ingredient) => {
            const substitution = substitutions[ingredient.id]
            return (
              <li
                key={ingredient.id}
                className="rounded-card border border-subtle bg-surface px-4 py-3 shadow-card"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CategoryDot category={ingredient.category} />
                    <span className="font-medium">{ingredient.food_name}</span>
                    <span className="text-sm text-muted">
                      {scaledQuantityLabel(ingredient, scale)}
                    </span>
                    {ingredient.note && (
                      <span className="text-xs text-faint">({ingredient.note})</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <AvailabilityBadge ingredient={ingredient} scale={scale} />
                    <button
                      type="button"
                      onClick={() => suggestSubstitute(ingredient)}
                      disabled={substitution?.status === 'loading'}
                      className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    >
                      {substitution?.status === 'loading' ? 'Thinking…' : 'Suggest substitute'}
                    </button>
                  </div>
                </div>
                {substitution?.status === 'error' && (
                  <p className="mt-2 text-xs text-danger">{substitution.message}</p>
                )}
                {substitution?.status === 'loaded' && (
                  <ul className="mt-2 flex flex-col gap-1 border-t border-subtle pt-2">
                    {substitution.suggestions.map((suggestion, index) => (
                      <li key={index} className="text-xs text-muted">
                        <span className="font-medium text-text">{suggestion.name}</span>
                        {(suggestion.quantity || suggestion.unit) && (
                          <span className="ml-1 text-faint">
                            ({[suggestion.quantity, suggestion.unit].filter(Boolean).join(' ')})
                          </span>
                        )}
                        {suggestion.note && <span className="ml-1">— {suggestion.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-muted">Instructions</h3>
        <ol className="flex flex-col gap-2 text-sm">
          {recipe.instructions.map((step, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-faint">{index + 1}.</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
