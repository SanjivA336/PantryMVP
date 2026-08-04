import { useEffect, useRef, useState } from 'react'
import { apiClient, ApiError } from '../lib/apiClient'
import { CategoryDot } from './CategoryDot'
import { FOOD_CATEGORIES, FOOD_CATEGORY_LABELS } from '../lib/foodCategories'
import type { FoodCategory, FoodDefinition } from '../types/entities'

interface Props {
  // Callers that only have a food's id/name on hand (e.g. pre-filling an
  // edit form from a recipe ingredient, which doesn't carry the full
  // FoodDefinition) can pass just that much -- this component only ever
  // reads `.name`/`.category` off the current value.
  value: Pick<FoodDefinition, 'id' | 'name'> & Partial<Pick<FoodDefinition, 'category'>> | null
  onChange: (food: FoodDefinition | null) => void
  // Pre-fills the search box (and fires the initial search) with a name
  // suggested by something upstream, e.g. an AI-parsed ingredient name that
  // hasn't been resolved to a real food yet. Only read once, on mount.
  initialQuery?: string
}

export function FoodSearchInput({ value, onChange, initialQuery }: Props) {
  const [query, setQuery] = useState(initialQuery ?? '')
  const [results, setResults] = useState<FoodDefinition[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newUnit, setNewUnit] = useState('count')
  const [newCategory, setNewCategory] = useState<FoodCategory>('OTHER')
  const [createError, setCreateError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    if (value || query.trim().length === 0) {
      setResults([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await apiClient.get<FoodDefinition[]>(
          `/api/food-definitions/search?query=${encodeURIComponent(query)}`,
        )
        setResults(data)
      } catch {
        setResults([])
      }
    }, 250)
    return () => clearTimeout(debounceRef.current)
    // value's identity changes on every parent render even when the food it
    // represents hasn't -- keying on its id instead avoids re-running this
    // debounce effect for unrelated re-renders while a food is selected.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, value?.id])

  const pick = (food: FoodDefinition) => {
    onChange(food)
    setOpen(false)
    setQuery('')
  }

  const clear = () => {
    onChange(null)
    setQuery('')
  }

  const createNew = async () => {
    setCreateError(null)
    try {
      const food = await apiClient.post<FoodDefinition>('/api/food-definitions', {
        name: query,
        preferred_unit: newUnit,
        category: newCategory,
      })
      pick(food)
      setCreating(false)
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-control border border-subtle bg-surface-2 px-2 py-2">
        {value.category !== undefined && <CategoryDot category={value.category} />}
        <span className="flex-1">{value.name}</span>
        <button
          type="button"
          onClick={clear}
          className="text-sm text-muted hover:text-text hover:underline"
        >
          Change
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        type="text"
        placeholder="Search for a food (e.g. milk)"
        className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-card border border-subtle bg-surface-2 shadow-raised">
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              onClick={() => pick(food)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
            >
              <CategoryDot category={food.category} />
              <span className="flex-1">{food.name}</span>
              {!food.is_verified && <span className="text-xs text-faint">(user-created)</span>}
            </button>
          ))}
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="block w-full px-3 py-2 text-left text-sm font-medium text-primary hover:bg-surface-hover"
            >
              + Create "{query}"
            </button>
          ) : (
            <div className="flex flex-col gap-3 p-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Unit</label>
                <select
                  className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text"
                  value={newUnit}
                  onChange={(e) => setNewUnit(e.target.value)}
                >
                  <option value="count">count</option>
                  <option value="g">g</option>
                  <option value="ml">ml</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-muted">Category</label>
                <select
                  className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text"
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as FoodCategory)}
                >
                  {FOOD_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {FOOD_CATEGORY_LABELS[category]}
                    </option>
                  ))}
                </select>
              </div>
              {createError && <p className="text-sm text-danger">{createError}</p>}
              <button
                type="button"
                onClick={createNew}
                className="rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
              >
                Create
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
