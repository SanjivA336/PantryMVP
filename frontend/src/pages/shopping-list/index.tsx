import { useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import type { ShoppingListItem, ShoppingListSection } from '../../types/entities'
import {
  addShoppingListItemSchema,
  addShoppingListSectionSchema,
  type AddShoppingListItemForm,
  type AddShoppingListSectionForm,
} from './schema'

export function ShoppingListPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const { data: sections, reload: reloadSections } = useHouseholdResource<ShoppingListSection[]>(
    householdId ? `/api/households/${householdId}/shopping-list/sections` : null,
  )
  const {
    data: items,
    loading,
    error: loadError,
    reload: reloadItems,
  } = useHouseholdResource<ShoppingListItem[]>(
    householdId ? `/api/households/${householdId}/shopping-list/items` : null,
  )
  const reloadAll = useCallback(() => {
    reloadSections()
    reloadItems()
  }, [reloadSections, reloadItems])
  useRealtimeSubscription('shopping_list_items', householdId ?? null, reloadAll)
  useRealtimeSubscription('shopping_list_sections', householdId ?? null, reloadAll)

  const [actionError, setActionError] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)

  const itemForm = useForm<AddShoppingListItemForm>({
    resolver: zodResolver(addShoppingListItemSchema),
    defaultValues: { name: '', section_id: '' },
  })
  const sectionForm = useForm<AddShoppingListSectionForm>({
    resolver: zodResolver(addShoppingListSectionSchema),
  })

  const addItem = async (values: AddShoppingListItemForm) => {
    setActionError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/shopping-list/items`, {
        name: values.name,
        section_id: values.section_id || null,
      })
      itemForm.reset({ name: '', section_id: values.section_id })
      reloadItems()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const addSection = async (values: AddShoppingListSectionForm) => {
    setActionError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/shopping-list/sections`, values)
      sectionForm.reset()
      reloadSections()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const removeItem = async (item: ShoppingListItem) => {
    setActionError(null)
    try {
      await apiClient.delete(`/api/households/${householdId}/shopping-list/items/${item.id}`)
      reloadItems()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const suggest = async () => {
    setActionError(null)
    setSuggesting(true)
    try {
      await apiClient.post(`/api/households/${householdId}/shopping-list/suggest`)
      reloadItems()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSuggesting(false)
    }
  }

  const sectionById = new Map((sections ?? []).map((s) => [s.id, s]))
  const itemsBySection = new Map<string | null, ShoppingListItem[]>()
  for (const item of items ?? []) {
    const key = item.section_id
    itemsBySection.set(key, [...(itemsBySection.get(key) ?? []), item])
  }
  const sectionOrder: (string | null)[] = [...(sections ?? []).map((s) => s.id), null]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Shopping List</h2>
        <button
          type="button"
          onClick={suggest}
          disabled={suggesting}
          className="rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          {suggesting ? 'Suggesting…' : 'Suggest List'}
        </button>
      </div>

      {(loadError || actionError) && (
        <p className="text-sm text-red-600">{loadError ?? actionError}</p>
      )}

      <form onSubmit={itemForm.handleSubmit(addItem)} className="flex flex-wrap items-start gap-3">
        <div className="flex-1">
          <input
            type="text"
            placeholder="Add an item (e.g. paper towels)"
            className="w-full rounded-md border border-gray-300 px-3 py-2"
            {...itemForm.register('name')}
          />
          {itemForm.formState.errors.name && (
            <p className="mt-1 text-sm text-red-600">{itemForm.formState.errors.name.message}</p>
          )}
        </div>
        <select
          className="rounded-md border border-gray-300 px-3 py-2"
          {...itemForm.register('section_id')}
        >
          <option value="">No section</option>
          {(sections ?? []).map((section) => (
            <option key={section.id} value={section.id}>
              {section.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={itemForm.formState.isSubmitting}
          className="rounded-md px-4 py-2 font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          Add
        </button>
      </form>

      <form
        onSubmit={sectionForm.handleSubmit(addSection)}
        className="flex items-start gap-3 text-sm"
      >
        <input
          type="text"
          placeholder="New section (e.g. Produce)"
          className="rounded-md border border-gray-300 px-3 py-2"
          {...sectionForm.register('name')}
        />
        <button
          type="submit"
          disabled={sectionForm.formState.isSubmitting}
          className="rounded-md border border-gray-300 px-3 py-2 font-medium text-gray-700 disabled:opacity-50"
        >
          + Add section
        </button>
      </form>

      {loading ? (
        <p className="text-sm">Loading…</p>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing on the list yet.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {sectionOrder.map((sectionId) => {
            const sectionItems = itemsBySection.get(sectionId) ?? []
            if (sectionItems.length === 0) return null
            const label = sectionId ? sectionById.get(sectionId)?.name : 'Other'
            return (
              <div key={sectionId ?? 'unsectioned'}>
                <h3 className="mb-2 text-sm font-semibold text-gray-500">{label}</h3>
                <ul className="flex flex-col gap-2">
                  {sectionItems.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-4 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <span>{item.name}</span>
                        {item.source === 'SUGGESTED' && (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                          >
                            Suggested
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => removeItem(item)}
                        className="text-sm text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
