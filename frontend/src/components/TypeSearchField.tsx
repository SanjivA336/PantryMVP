import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { apiClient, ApiError } from '../lib/apiClient'
import { CategoryDot } from './CategoryDot'
import { Modal } from './Modal'
import { FOOD_CATEGORIES, FOOD_CATEGORY_LABELS } from '../lib/foodCategories'
import type { FoodCategory, FoodDefinition } from '../types/entities'

interface Props {
  value: FoodDefinition | null
  onChange: (food: FoodDefinition | null) => void
}

// Unlike FoodSearchInput (used in recipe/receipt rows, where a compact
// floating dropdown is the right call), this renders results directly in
// the page's own flow -- no absolute-positioned overlay -- since the Add
// Item form wants this to read as one continuous list of fields, not a
// popover sitting on top of the rest of the form.
export function TypeSearchField({ value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodDefinition[]>([])
  const [creatingOpen, setCreatingOpen] = useState(false)
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
    setQuery('')
  }

  const clear = () => {
    onChange(null)
    setQuery('')
  }

  const openCreateModal = () => {
    setNewUnit('count')
    setNewCategory('OTHER')
    setCreateError(null)
    setCreatingOpen(true)
  }

  const createNew = async () => {
    setCreateError(null)
    try {
      const food = await apiClient.post<FoodDefinition>('/api/food-definitions', {
        name: query,
        preferred_unit: newUnit,
        category: newCategory,
      })
      setCreatingOpen(false)
      pick(food)
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-control border border-subtle bg-surface-2 px-2 py-2">
        <CategoryDot category={value.category} />
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
    <div>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search for a food (e.g. milk)"
          className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          onClick={openCreateModal}
          disabled={query.trim().length === 0}
          title="Create a new food type"
          aria-label="Create a new food type"
          className="flex shrink-0 items-center justify-center rounded-control bg-primary-soft px-3 text-primary transition-colors hover:bg-primary hover:text-bg disabled:pointer-events-none disabled:opacity-40"
        >
          <Plus size={18} strokeWidth={2} />
        </button>
      </div>
      {results.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              onClick={() => pick(food)}
              className="flex w-full items-center gap-2 rounded-control border border-subtle bg-surface-2 px-2 py-2 text-left text-sm hover:bg-surface-hover"
            >
              <CategoryDot category={food.category} />
              <span className="flex-1">{food.name}</span>
              {!food.is_verified && <span className="text-xs text-faint">(user-created)</span>}
            </button>
          ))}
        </div>
      )}

      {creatingOpen && (
        <Modal title={`Create "${query}"`} onClose={() => setCreatingOpen(false)}>
          <div className="flex flex-col gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Unit</label>
              <select
                className="w-full rounded-control border border-subtle bg-surface px-2 py-2 text-sm text-text"
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
                className="w-full rounded-control border border-subtle bg-surface px-2 py-2 text-sm text-text"
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
        </Modal>
      )}
    </div>
  )
}
