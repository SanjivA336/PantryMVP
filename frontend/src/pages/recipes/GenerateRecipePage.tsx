import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import type { DraftRecipe, InventoryItem, RecipeDetail } from '../../types/entities'
import { draftRecipeToFormInitial } from './aiDraftAdapter'
import { RecipeForm, type RecipeSubmitBody } from './RecipeForm'

// The backend allows up to ai_request_timeout_seconds (60s) for the
// initial call plus one repair retry on bad output -- worst case ~120s
// server-side. This must clear that with margin, or the client aborts and
// shows "timed out" for a request the backend would have finished.
const AI_TIMEOUT_MS = 130_000

const CUISINES = [
  'Italian',
  'Mexican',
  'Chinese',
  'Indian',
  'Thai',
  'Japanese',
  'Mediterranean',
  'American',
  'French',
  'Korean',
  'Middle Eastern',
  'Any',
]

const TIME_RANGES: { key: string; label: string; min: number; max: number | null }[] = [
  { key: '5-10', label: '5–10 min', min: 5, max: 10 },
  { key: '15-20', label: '15–20 min', min: 15, max: 20 },
  { key: '30-45', label: '30–45 min', min: 30, max: 45 },
  { key: '1hr+', label: '1hr+', min: 60, max: null },
]

function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

export function GenerateRecipePage() {
  const { householdId } = useParams<{ householdId: string }>()
  const navigate = useNavigate()

  const [selectedCuisines, setSelectedCuisines] = useState<string[]>([])
  const [timeRangeKey, setTimeRangeKey] = useState('')
  const [dietaryRestrictions, setDietaryRestrictions] = useState('')
  const [description, setDescription] = useState('')
  const [requiredTags, setRequiredTags] = useState<string[]>([])
  const [ingredientSearch, setIngredientSearch] = useState('')
  const [pantryOnly, setPantryOnly] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftRecipe | null>(null)

  const { data: inventoryItems } = useHouseholdResource<InventoryItem[]>(
    householdId ? `/api/households/${householdId}/inventory-items?status=ACTIVE` : null,
  )
  const inventoryFoodNames = useMemo(() => {
    const names = new Set((inventoryItems ?? []).map((i) => i.food_name))
    return [...names]
  }, [inventoryItems])
  const ingredientMatches = useMemo(() => {
    const term = ingredientSearch.trim().toLowerCase()
    if (!term) return []
    return inventoryFoodNames
      .filter((name) => name.toLowerCase().includes(term) && !requiredTags.includes(name))
      .slice(0, 6)
  }, [ingredientSearch, inventoryFoodNames, requiredTags])

  const toggleCuisine = (cuisine: string) =>
    setSelectedCuisines((prev) =>
      prev.includes(cuisine) ? prev.filter((c) => c !== cuisine) : [...prev, cuisine],
    )

  const addIngredientTag = (name: string) => {
    setRequiredTags((prev) => (prev.includes(name) ? prev : [...prev, name]))
    setIngredientSearch('')
  }
  const removeIngredientTag = (name: string) =>
    setRequiredTags((prev) => prev.filter((t) => t !== name))

  const runGenerate = async () => {
    setGenerateError(null)
    setGenerating(true)
    const range = TIME_RANGES.find((r) => r.key === timeRangeKey)
    try {
      const result = await apiClient.post<DraftRecipe>(
        `/api/households/${householdId}/recipes/ai/generate`,
        {
          cuisines: selectedCuisines,
          min_total_time_minutes: range?.min ?? null,
          max_total_time_minutes: range?.max ?? null,
          dietary_restrictions: splitCommaList(dietaryRestrictions),
          required_ingredients: requiredTags,
          description: description.trim() || null,
          pantry_only: pantryOnly,
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
        <h2 className="mb-1 text-xl font-semibold">Review generated recipe</h2>
        <p className="mb-4 text-sm text-muted">
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
      <h2 className="mb-4 text-xl font-semibold">Generate a recipe with AI</h2>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Cuisine (optional, pick any number)
          </label>
          <div className="flex flex-wrap gap-2">
            {CUISINES.map((cuisine) => {
              const selected = selectedCuisines.includes(cuisine)
              return (
                <button
                  key={cuisine}
                  type="button"
                  onClick={() => toggleCuisine(cuisine)}
                  className={`rounded-control border px-3 py-1.5 text-sm font-medium transition-colors ${
                    selected
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
                  }`}
                >
                  {cuisine}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Total time (optional)
          </label>
          <div className="flex flex-wrap gap-2">
            {TIME_RANGES.map((range) => {
              const selected = timeRangeKey === range.key
              return (
                <button
                  key={range.key}
                  type="button"
                  onClick={() => setTimeRangeKey(selected ? '' : range.key)}
                  className={`rounded-control border px-3 py-1.5 text-sm font-medium transition-colors ${
                    selected
                      ? 'border-primary bg-primary-soft text-primary'
                      : 'border-subtle bg-surface-2 text-muted hover:bg-surface-hover'
                  }`}
                >
                  {range.label}
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Dietary restrictions (comma-separated, optional)
          </label>
          <input
            type="text"
            placeholder="e.g. vegetarian, gluten-free"
            className={inputClass}
            value={dietaryRestrictions}
            onChange={(e) => setDietaryRestrictions(e.target.value)}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Required ingredients (optional, from your inventory)
          </label>
          {requiredTags.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {requiredTags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-pill bg-primary-soft py-0.5 pl-2.5 pr-1.5 text-xs font-medium text-primary"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeIngredientTag(tag)}
                    aria-label={`Remove ${tag}`}
                    className="rounded-full p-0.5 hover:bg-primary hover:text-bg"
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <input
              type="text"
              placeholder="Search your inventory (e.g. chicken)"
              className={inputClass}
              value={ingredientSearch}
              onChange={(e) => setIngredientSearch(e.target.value)}
            />
            {ingredientMatches.length > 0 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-card border border-subtle bg-surface-2 shadow-raised">
                {ingredientMatches.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => addIngredientTag(name)}
                    className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-hover"
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-control border border-subtle bg-surface-2 px-3 py-2.5">
          <div>
            <p className="text-sm font-medium text-text">Only use items from my kitchen</p>
            <p className="text-xs text-faint">
              Sticks to your current inventory, plus basic seasonings, oil, and water.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={pantryOnly}
            aria-label="Only use items from my kitchen"
            onClick={() => setPantryOnly((prev) => !prev)}
            className={`relative h-6 w-11 shrink-0 rounded-pill transition-colors ${
              pantryOnly ? 'bg-primary' : 'bg-surface-hover'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-bg shadow-card transition-transform ${
                pantryOnly ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-muted">
            Describe what you want (optional)
          </label>
          <textarea
            rows={2}
            placeholder="e.g. something with leftover rice, kid-friendly"
            className={inputClass}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>

      {generateError && <p className="mt-3 text-sm text-danger">{generateError}</p>}

      <button
        type="button"
        onClick={runGenerate}
        disabled={generating}
        className="mt-4 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
      >
        {generating ? 'Generating…' : 'Generate'}
      </button>
    </div>
  )
}
