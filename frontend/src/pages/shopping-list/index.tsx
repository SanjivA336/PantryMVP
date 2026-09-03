import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ListX,
  Pencil,
  Plus,
  ShoppingCart,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { EmptyState } from '../../components/EmptyState'
import { FoodSearchInput } from '../../components/FoodSearchInput'
import { Modal } from '../../components/Modal'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import type {
  FoodDefinition,
  HouseholdWarnings,
  ShoppingListItem,
  ShoppingListSection,
} from '../../types/entities'
import { addShoppingListSectionSchema, type AddShoppingListSectionForm } from './schema'

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

const STOCK_REASON_LABEL: Record<string, string> = {
  OUT_OF_STOCK: 'Out of stock',
  LOW_STOCK: 'Running low',
}

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
  // Reused just to answer "why was this suggested" -- shows the food's
  // *current* stock signal, which is a reasonable stand-in for the signal
  // that originally produced the suggestion (the backend doesn't store the
  // original reason separately).
  const { data: warnings, reload: reloadWarnings } = useHouseholdResource<HouseholdWarnings>(
    householdId ? `/api/households/${householdId}/warnings` : null,
  )
  const reloadAll = useCallback(() => {
    reloadSections()
    reloadItems()
    reloadWarnings()
  }, [reloadSections, reloadItems, reloadWarnings])
  useRealtimeSubscription('shopping_list_items', householdId ?? null, reloadAll)
  useRealtimeSubscription('shopping_list_sections', householdId ?? null, reloadAll)
  // Stock levels changing elsewhere (e.g. someone uses up an item in
  // Inventory) shifts the warnings this page's "Suggested because…" reason
  // reads from -- without this, that reason text goes stale until an
  // unrelated full reload happens to touch it.
  useRealtimeSubscription('inventory_items', householdId ?? null, reloadWarnings)

  const [actionError, setActionError] = useState<string | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [addingToSection, setAddingToSection] = useState<string | 'unsectioned' | null>(null)
  const [addingSection, setAddingSection] = useState(false)
  const [movingItem, setMovingItem] = useState<ShoppingListItem | null>(null)
  const [openReasonFor, setOpenReasonFor] = useState<string | null>(null)
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')

  const sectionForm = useForm<AddShoppingListSectionForm>({
    resolver: zodResolver(addShoppingListSectionSchema),
  })

  const reasonByVariantId = useMemo(() => {
    const map = new Map<string, string>()
    for (const w of warnings?.stock_warnings ?? []) {
      map.set(w.household_food_variant_id, STOCK_REASON_LABEL[w.type] ?? w.type)
    }
    return map
  }, [warnings])

  const addItem = async (food: FoodDefinition, sectionId: string | null) => {
    setActionError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/shopping-list/items`, {
        global_food_definition_id: food.id,
        section_id: sectionId,
      })
      setAddingToSection(null)
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
      setAddingSection(false)
      reloadSections()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const startEditSection = (section: ShoppingListSection) => {
    setEditingSectionId(section.id)
    setEditingName(section.name)
  }
  const cancelEditSection = () => setEditingSectionId(null)

  const saveEditSection = async (section: ShoppingListSection) => {
    const name = editingName.trim()
    if (!name) return
    setActionError(null)
    try {
      await apiClient.patch(`/api/households/${householdId}/shopping-list/sections/${section.id}`, {
        name,
      })
      setEditingSectionId(null)
      reloadSections()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const deleteSection = async (section: ShoppingListSection) => {
    setActionError(null)
    try {
      await apiClient.delete(`/api/households/${householdId}/shopping-list/sections/${section.id}`)
      // Items in the deleted section fall back to "Other" server-side
      // (section_id -> null), not deleted -- reload both so the client
      // picks up their new bucket instead of showing stale section_ids.
      reloadSections()
      reloadItems()
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

  const ignorePermanently = async (item: ShoppingListItem) => {
    if (!item.household_food_variant_id) return
    setActionError(null)
    try {
      // Delete first, ignore second -- there's no "unignore" endpoint to
      // roll back with, so the irreversible step has to be the one that
      // only runs once the reversible one has already succeeded. Worst
      // case on a failure here is the item just isn't ignored yet (safe to
      // retry); the old order's worst case was "ignored forever but still
      // stuck on the list."
      await apiClient.delete(`/api/households/${householdId}/shopping-list/items/${item.id}`)
      await apiClient.post(`/api/households/${householdId}/shopping-list/ignored-variants`, {
        household_food_variant_id: item.household_food_variant_id,
      })
      setOpenReasonFor(null)
      reloadItems()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const toggleCollected = async (item: ShoppingListItem) => {
    setActionError(null)
    try {
      await apiClient.patch(`/api/households/${householdId}/shopping-list/items/${item.id}`, {
        collected: !item.collected,
      })
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

  const clearList = async () => {
    setActionError(null)
    setClearing(true)
    try {
      await apiClient.post(`/api/households/${householdId}/shopping-list/clear`)
      reloadItems()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setClearing(false)
    }
  }

  const sortedSections = useMemo(
    () => [...(sections ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [sections],
  )
  const itemsBySection = useMemo(() => {
    const map = new Map<string | null, ShoppingListItem[]>()
    for (const item of items ?? []) {
      const key = item.section_id
      map.set(key, [...(map.get(key) ?? []), item])
    }
    return map
  }, [items])
  // Sorted once here rather than inline in the render loop below, so
  // re-renders that don't touch itemsBySection (e.g. opening the rename
  // input) don't re-sort every bucket.
  const sortedItemsBySection = useMemo(() => {
    const map = new Map<string | null, ShoppingListItem[]>()
    for (const [key, bucketItems] of itemsBySection) {
      map.set(
        key,
        [...bucketItems].sort((a, b) => a.sort_order - b.sort_order),
      )
    }
    return map
  }, [itemsBySection])
  const sectionById = useMemo(() => new Map(sortedSections.map((s) => [s.id, s])), [sortedSections])
  const sectionBuckets: { id: string | null; name: string }[] = [
    ...sortedSections.map((s) => ({ id: s.id, name: s.name })),
    { id: null, name: 'Other' },
  ]

  const moveSection = async (section: ShoppingListSection, direction: -1 | 1) => {
    const index = sortedSections.findIndex((s) => s.id === section.id)
    const neighbor = sortedSections[index + direction]
    if (!neighbor) return
    setActionError(null)
    const sectionUrl = (id: string) => `/api/households/${householdId}/shopping-list/sections/${id}`
    const [sectionResult, neighborResult] = await Promise.allSettled([
      apiClient.patch(sectionUrl(section.id), { sort_order: neighbor.sort_order }),
      apiClient.patch(sectionUrl(neighbor.id), { sort_order: section.sort_order }),
    ])
    // A plain Promise.all would fail fast on whichever call rejects first
    // without undoing the other -- leaving both rows sharing one sort_order
    // if only half the swap actually landed. allSettled lets us roll back
    // whichever half succeeded instead of leaving that half-applied.
    if (sectionResult.status === 'rejected' || neighborResult.status === 'rejected') {
      if (sectionResult.status === 'fulfilled') {
        await apiClient
          .patch(sectionUrl(section.id), { sort_order: section.sort_order })
          .catch(() => {})
      }
      if (neighborResult.status === 'fulfilled') {
        await apiClient
          .patch(sectionUrl(neighbor.id), { sort_order: neighbor.sort_order })
          .catch(() => {})
      }
      setActionError('Something went wrong')
    }
    reloadSections()
  }

  const moveItem = async (item: ShoppingListItem, direction: -1 | 1) => {
    const bucket = itemsBySection.get(item.section_id) ?? []
    const index = bucket.findIndex((i) => i.id === item.id)
    const neighbor = bucket[index + direction]
    if (!neighbor) return
    setActionError(null)
    const itemUrl = (id: string) => `/api/households/${householdId}/shopping-list/items/${id}`
    const [itemResult, neighborResult] = await Promise.allSettled([
      apiClient.patch(itemUrl(item.id), { sort_order: neighbor.sort_order }),
      apiClient.patch(itemUrl(neighbor.id), { sort_order: item.sort_order }),
    ])
    if (itemResult.status === 'rejected' || neighborResult.status === 'rejected') {
      if (itemResult.status === 'fulfilled') {
        await apiClient.patch(itemUrl(item.id), { sort_order: item.sort_order }).catch(() => {})
      }
      if (neighborResult.status === 'fulfilled') {
        await apiClient
          .patch(itemUrl(neighbor.id), { sort_order: neighbor.sort_order })
          .catch(() => {})
      }
      setActionError('Something went wrong')
    }
    reloadItems()
  }

  const moveToSection = async (item: ShoppingListItem, targetSectionId: string | null) => {
    setActionError(null)
    const destination = itemsBySection.get(targetSectionId) ?? []
    const nextSortOrder = destination.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1
    try {
      await apiClient.patch(`/api/households/${householdId}/shopping-list/items/${item.id}`, {
        section_id: targetSectionId,
        sort_order: nextSortOrder,
      })
      setMovingItem(null)
      reloadItems()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const hasAnyItems = (items ?? []).length > 0

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Shopping List</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={clearList}
            disabled={clearing || !hasAnyItems}
            className="flex items-center gap-1.5 rounded-control border border-subtle bg-surface px-2 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface-hover disabled:opacity-50"
          >
            <ListX size={16} strokeWidth={1.75} />
            {clearing ? 'Clearing…' : 'Clear List'}
          </button>
          <button
            type="button"
            onClick={suggest}
            disabled={suggesting}
            className="flex items-center gap-1.5 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            <Sparkles size={16} strokeWidth={2.25} />
            {suggesting ? 'Suggesting…' : 'Suggest List'}
          </button>
        </div>
      </div>

      {(loadError || actionError) && (
        <p className="text-sm text-danger">{loadError ?? actionError}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !hasAnyItems && sortedSections.length === 0 ? (
        <EmptyState
          icon={ShoppingCart}
          title="Nothing on the list yet."
          hint={'Add a section below, or add an item and it’ll land in "Other."'}
        />
      ) : null}

      <div className="flex flex-col gap-4">
        {sectionBuckets.map((bucket, bucketIndex) => {
          const sectionItems = sortedItemsBySection.get(bucket.id) ?? []
          const section = bucket.id ? sectionById.get(bucket.id) : null
          const isEditingName = section != null && editingSectionId === section.id
          return (
            <div
              key={bucket.id ?? 'unsectioned'}
              className="-mx-2 rounded-card px-2 py-2 transition-colors hover:bg-surface-hover"
            >
              <div className="flex items-center gap-2">
                {section && (
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button"
                      onClick={() => moveSection(section, -1)}
                      disabled={bucketIndex === 0}
                      className="text-faint hover:text-text disabled:opacity-30"
                      aria-label="Move section up"
                    >
                      <ChevronUp size={12} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveSection(section, 1)}
                      disabled={bucketIndex === sortedSections.length - 1}
                      className="text-faint hover:text-text disabled:opacity-30"
                      aria-label="Move section down"
                    >
                      <ChevronDown size={12} strokeWidth={2} />
                    </button>
                  </div>
                )}
                {isEditingName && section ? (
                  <input
                    type="text"
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveEditSection(section)
                      if (e.key === 'Escape') cancelEditSection()
                    }}
                    className="min-w-0 flex-1 rounded-control border border-subtle bg-surface-2 px-2 py-1 text-sm font-semibold text-text outline-none focus:border-primary"
                  />
                ) : (
                  <h3 className="flex-1 truncate text-sm font-semibold text-muted">
                    {bucket.name}
                  </h3>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setAddingToSection(
                      addingToSection === (bucket.id ?? 'unsectioned')
                        ? null
                        : (bucket.id ?? 'unsectioned'),
                    )
                  }
                  title="Add item to this section"
                  aria-label="Add item to this section"
                  className="shrink-0 rounded-control p-1 text-faint transition-colors hover:bg-surface-hover hover:text-primary"
                >
                  <Plus size={14} strokeWidth={2.25} />
                </button>
                {section && (
                  <>
                    {isEditingName ? (
                      <button
                        type="button"
                        onClick={() => saveEditSection(section)}
                        title="Save name"
                        aria-label="Save section name"
                        className="shrink-0 rounded-control p-1 text-primary transition-colors hover:bg-primary-soft"
                      >
                        <Check size={14} strokeWidth={2.25} />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEditSection(section)}
                        title="Edit name"
                        aria-label="Edit section name"
                        className="shrink-0 rounded-control p-1 text-faint transition-colors hover:bg-surface-hover hover:text-text"
                      >
                        <Pencil size={14} strokeWidth={1.75} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteSection(section)}
                      title="Delete section"
                      aria-label="Delete section"
                      className="shrink-0 rounded-control p-1 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </>
                )}
              </div>
              <div className="mt-2 mb-3 border-b border-subtle" />

              {addingToSection === (bucket.id ?? 'unsectioned') && (
                <div className="mb-2">
                  <FoodSearchInput
                    value={null}
                    onChange={(food) => food && addItem(food, bucket.id)}
                  />
                </div>
              )}

              {sectionItems.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {sectionItems.map((item, itemIndex) => (
                    <li
                      key={item.id}
                      className={`flex items-center gap-2 rounded-control border border-subtle bg-surface px-3 py-2.5 ${
                        item.collected ? 'bg-primary-soft/40' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => toggleCollected(item)}
                        aria-label={item.collected ? 'Mark not collected' : 'Mark collected'}
                        className={`flex size-5 shrink-0 items-center justify-center rounded-control border transition-colors ${
                          item.collected
                            ? 'border-primary bg-primary text-bg'
                            : 'border-subtle-strong bg-surface-2'
                        }`}
                      >
                        {item.collected && (
                          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                            <path
                              d="M3 8l3.5 3.5L13 5"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                      <span
                        className={`flex-1 text-sm ${item.collected ? 'text-muted line-through' : 'text-text'}`}
                      >
                        {item.name}
                      </span>
                      {item.source === 'SUGGESTED' && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() =>
                              setOpenReasonFor(openReasonFor === item.id ? null : item.id)
                            }
                            className="rounded-pill bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary"
                          >
                            Suggested
                          </button>
                          {openReasonFor === item.id && (
                            <div className="absolute right-0 z-10 mt-1 w-56 rounded-card border border-subtle bg-surface-2 p-3 text-xs shadow-raised">
                              <p className="mb-2 text-muted">
                                {item.household_food_variant_id &&
                                reasonByVariantId.has(item.household_food_variant_id)
                                  ? `Suggested because: ${reasonByVariantId.get(item.household_food_variant_id)}`
                                  : 'Suggested based on your stock levels.'}
                              </p>
                              <button
                                type="button"
                                onClick={() => ignorePermanently(item)}
                                className="w-full rounded-control border border-danger/30 px-2 py-1 text-left font-medium text-danger transition-colors hover:bg-danger-soft"
                              >
                                Ignore permanently
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveItem(item, -1)}
                          disabled={itemIndex === 0}
                          className="rounded-control p-1 text-faint transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
                          aria-label="Move item up"
                        >
                          <ChevronUp size={14} strokeWidth={2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveItem(item, 1)}
                          disabled={itemIndex === sectionItems.length - 1}
                          className="rounded-control p-1 text-faint transition-colors hover:bg-surface-hover hover:text-text disabled:opacity-30"
                          aria-label="Move item down"
                        >
                          <ChevronDown size={14} strokeWidth={2} />
                        </button>
                        {sortedSections.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setMovingItem(item)}
                            title="Move to a different section"
                            className="rounded-control px-1.5 py-1 text-xs font-medium text-faint transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            Move
                          </button>
                        )}
                        <button
                          type="button"
                          title="Remove"
                          onClick={() => removeItem(item)}
                          className="rounded-control p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
                        >
                          <X size={16} strokeWidth={1.75} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}

        {addingSection ? (
          <form
            onSubmit={sectionForm.handleSubmit(addSection)}
            className="flex items-start gap-2 rounded-card border border-dashed border-subtle p-3"
          >
            <input
              type="text"
              autoFocus
              placeholder="Section name (e.g. Produce)"
              className={inputClass}
              {...sectionForm.register('name')}
            />
            <button
              type="submit"
              disabled={sectionForm.formState.isSubmitting}
              className="shrink-0 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setAddingSection(false)}
              className="shrink-0 rounded-control p-2 text-faint hover:text-text"
              aria-label="Cancel"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAddingSection(true)}
            className="flex items-center justify-center gap-1.5 rounded-card border border-dashed border-subtle p-3 text-sm font-medium text-muted transition-colors hover:border-subtle-strong hover:text-text"
          >
            <Plus size={16} strokeWidth={2.25} />
            Add section
          </button>
        )}
      </div>

      {movingItem && (
        <Modal title={`Move "${movingItem.name}"`} onClose={() => setMovingItem(null)}>
          <div className="flex flex-col gap-1.5">
            {sectionBuckets
              .filter((b) => b.id !== movingItem.section_id)
              .map((bucket) => (
                <button
                  key={bucket.id ?? 'unsectioned'}
                  type="button"
                  onClick={() => moveToSection(movingItem, bucket.id)}
                  className="rounded-control border border-subtle bg-surface-2 px-3 py-2 text-left text-sm hover:bg-surface-hover"
                >
                  {bucket.name}
                </button>
              ))}
          </div>
        </Modal>
      )}
    </div>
  )
}
