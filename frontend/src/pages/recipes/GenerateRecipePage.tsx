import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient, ApiError } from '../../lib/apiClient'
import type { DraftRecipe, RecipeDetail } from '../../types/entities'
import { draftRecipeToFormInitial } from './aiDraftAdapter'
import { RecipeForm, type RecipeSubmitBody } from './RecipeForm'

// The backend allows up to ai_request_timeout_seconds (60s) for the
// initial call plus one repair retry on bad output -- worst case ~120s
// server-side. This must clear that with margin, or the client aborts and
// shows "timed out" for a request the backend would have finished.
const AI_TIMEOUT_MS = 130_000

function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function GenerateRecipePage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()

  const [cuisine, setCuisine] = useState('')
  const [maxTotalTime, setMaxTotalTime] = useState('')
  const [servings, setServings] = useState('')
  const [dietaryRestrictions, setDietaryRestrictions] = useState('')
  const [requiredIngredients, setRequiredIngredients] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRecipe | null>(null)

  const runGenerate = async () => {
    setGenerateError(null)
    setGenerating(true)
    try {
      const result = await apiClient.post<DraftRecipe>(
        `/api/households/${householdId}/recipes/ai/generate`,
        {
          cuisine: cuisine.trim() || null,
          max_total_time_minutes: maxTotalTime.trim() ? Number(maxTotalTime) : null,
          servings: servings.trim() ? Number(servings) : null,
          dietary_restrictions: splitCommaList(dietaryRestrictions),
          required_ingredients: splitCommaList(requiredIngredients),
        },
        { timeoutMs: AI_TIMEOUT_MS },
      )
      setDraft(result)
    } catch (err) {
      setGenerateError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setGenerating(false)
    }
  }

  const onSubmit = async (body: RecipeSubmitBody) => {
    const recipe = await apiClient.post<RecipeDetail>(
      `/api/households/${householdId}/recipes`,
      body,
    )
    navigate(`/households/${householdId}/recipes/${recipe.id}`)
  }

  if (draft) {
    return (
      <div className="mx-auto max-w-2xl">
        <h2 className="mb-1 text-lg font-semibold">Review generated recipe</h2>
        <p className="mb-4 text-sm text-gray-500">
          Check the AI's work below, especially quantities and units, then pick a real food for
          each ingredient before saving.
        </p>
        <RecipeForm
          initial={draftRecipeToFormInitial(draft)}
          submitLabel="Save recipe"
          onSubmit={onSubmit}
        />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-4 text-lg font-semibold">Generate a recipe with AI</h2>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Cuisine (optional)</label>
          <input
            type="text"
            placeholder="e.g. Mexican"
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            value={cuisine}
            onChange={(e) => setCuisine(e.target.value)}
          />
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Max total time (min)</label>
            <input
              type="number"
              min={1}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={maxTotalTime}
              onChange={(e) => setMaxTotalTime(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium">Servings</label>
            <input
              type="number"
              min={1}
              className="w-full rounded-md border border-gray-300 px-3 py-2"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Dietary restrictions (comma-separated, optional)
          </label>
          <input
            type="text"
            placeholder="e.g. vegetarian, gluten-free"
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            value={dietaryRestrictions}
            onChange={(e) => setDietaryRestrictions(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Required ingredients (comma-separated, optional)
          </label>
          <input
            type="text"
            placeholder="e.g. chicken, rice"
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            value={requiredIngredients}
            onChange={(e) => setRequiredIngredients(e.target.value)}
          />
        </div>
      </div>

      {generateError && <p className="mt-3 text-sm text-red-600">{generateError}</p>}

      <button
        type="button"
        onClick={runGenerate}
        disabled={generating}
        className="mt-4 rounded-md px-4 py-2 font-medium text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--color-primary)' }}
      >
        {generating ? 'Generating…' : 'Generate'}
      </button>
    </div>
  )
}
