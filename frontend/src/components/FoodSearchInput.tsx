import { useEffect, useRef, useState } from 'react'
import { apiClient } from '../lib/apiClient'
import type { FoodDefinition } from '../types/entities'

interface Props {
  value: FoodDefinition | null
  onChange: (food: FoodDefinition | null) => void
}

export function FoodSearchInput({ value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoodDefinition[]>([])
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newUnit, setNewUnit] = useState('count')
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
  }, [query, value])

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
    const food = await apiClient.post<FoodDefinition>('/api/food-definitions', {
      name: query,
      preferred_unit: newUnit,
    })
    pick(food)
    setCreating(false)
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-gray-300 px-3 py-2">
        <span className="flex-1">{value.name}</span>
        <button type="button" onClick={clear} className="text-sm text-gray-500 hover:underline">
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
        className="w-full rounded-md border border-gray-300 px-3 py-2"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg">
          {results.map((food) => (
            <button
              key={food.id}
              type="button"
              onClick={() => pick(food)}
              className="block w-full px-3 py-2 text-left hover:bg-gray-50"
            >
              {food.name}
              {!food.is_verified && (
                <span className="ml-2 text-xs text-gray-400">(user-created)</span>
              )}
            </button>
          ))}
          {!creating ? (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="block w-full px-3 py-2 text-left text-sm font-medium hover:bg-gray-50"
              style={{ color: 'var(--color-primary)' }}
            >
              + Create "{query}"
            </button>
          ) : (
            <div className="flex items-center gap-2 border-t border-gray-100 p-2">
              <span className="text-sm">Unit:</span>
              <select
                className="rounded border border-gray-300 px-2 py-1 text-sm"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
              >
                <option value="count">count</option>
                <option value="g">g</option>
                <option value="ml">ml</option>
              </select>
              <button
                type="button"
                onClick={createNew}
                className="rounded px-2 py-1 text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}
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
