import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  CalendarX,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  LayoutGrid,
  MapPin,
  Package,
  Pencil,
  Plus,
  Rows3,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { apiClient, ApiError } from '../../lib/apiClient'
import { CategoryDot } from '../../components/CategoryDot'
import { Modal } from '../../components/Modal'
import { WarningCounts } from '../../components/WarningCounts'
import { useAuth } from '../../hooks/useAuth'
import {
  FOOD_CATEGORIES,
  FOOD_CATEGORY_BORDER_CLASSES,
  FOOD_CATEGORY_LABELS,
} from '../../lib/foodCategories'
import {
  STORAGE_TYPE_BADGE_CLASSES,
  STORAGE_TYPE_BORDER_CLASSES,
  STORAGE_TYPE_LABELS,
  STORAGE_TYPES,
} from '../../lib/storageTypes'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import type {
  AccountingType,
  FoodCategory,
  HouseholdWarnings,
  InventoryItem,
  RemovalReason,
  StorageLocation,
  StorageLocationType,
} from '../../types/entities'
import { storageLocationSchema, type StorageLocationForm } from '../storage/schema'
import { WarningsButton } from './WarningsButton'

const ACCOUNTING_TYPE_LABELS: Record<AccountingType, string> = {
  PERSONAL: 'Personal',
  SHARED_CONSUMABLE: 'Shared',
  UNIT_BASED: 'Unit-based',
}

const inputClass =
  'w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary'

const addChoiceClass =
  'flex flex-1 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-subtle p-6 text-sm font-medium text-muted transition-colors hover:border-subtle-strong hover:text-text'

type ViewMode = 'flat' | 'sectional'

// Per (user, household) rather than per user globally -- someone in a
// household with 2 storage locations gets little from the grouped view,
// while someone in one with 8 might always want it; the two shouldn't share
// a single global default. Only ever written when the user actively
// switches views (see changeView below), never on load -- so anyone who's
// never touched it keeps riding whatever the app's default is, even if that
// default changes later.
function viewPrefKey(userId: string, householdId: string): string {
  return `burrow-inventory-view:${userId}:${householdId}`
}

// One combined line instead of a separate "Expires {date}" line plus its own
// warning badge -- the tense (Expires/Expired) and day/days pluralization
// are both simple sign/magnitude checks on the same days-until number, and
// the color swap (muted -> danger) carries the "past due" signal on its own
// without a second visual element competing for attention.
function expiryText(expiryDate: string): { text: string; expired: boolean } {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${expiryDate}T00:00:00`)
  const daysUntil = Math.round((target.getTime() - today.getTime()) / 86_400_000)
  const expired = daysUntil < 0
  const n = Math.abs(daysUntil)
  const dayWord = n === 1 ? 'day' : 'days'
  if (daysUntil === 0) return { text: 'Expires today', expired: false }
  return {
    text: expired
      ? `Expired on ${expiryDate} (${n} ${dayWord} ago)`
      : `Expires on ${expiryDate} (${n} ${dayWord})`,
    expired,
  }
}

export function InventoryPage() {
  const { householdId, storageLocationId } = useParams<{
    householdId: string
    storageLocationId?: string
  }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const itemsUrl = householdId
    ? `/api/households/${householdId}/inventory-items?status=ACTIVE${
        storageLocationId ? `&storage_location_id=${storageLocationId}` : ''
      }`
    : null
  const {
    data: items,
    loading,
    error: loadError,
    reload,
  } = useHouseholdResource<InventoryItem[]>(itemsUrl)
  const { data: storageLocation } = useHouseholdResource<StorageLocation>(
    householdId && storageLocationId
      ? `/api/households/${householdId}/storage-locations/${storageLocationId}`
      : null,
  )
  const { data: allStorageLocations, reload: reloadStorageLocations } = useHouseholdResource<
    StorageLocation[]
  >(householdId ? `/api/households/${householdId}/storage-locations` : null)
  const { data: warnings, reload: reloadWarnings } = useHouseholdResource<HouseholdWarnings>(
    householdId ? `/api/households/${householdId}/warnings` : null,
  )
  // Another member consuming/adding/discarding an item on their own device
  // shows up here without a manual refresh -- one channel driving both
  // resources, rather than opening a second subscription to the same table.
  const reloadAll = useCallback(() => {
    reload()
    reloadWarnings()
    reloadStorageLocations()
  }, [reload, reloadWarnings, reloadStorageLocations])
  useRealtimeSubscription('inventory_items', householdId ?? null, reloadAll)
  const [actionError, setActionError] = useState<string | null>(null)
  const [consumeAmounts, setConsumeAmounts] = useState<Record<string, string>>({})
  const [usingItemId, setUsingItemId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<FoodCategory | ''>('')
  const [storageTypeFilter, setStorageTypeFilter] = useState<StorageLocationType | ''>('')
  const [addPickerOpen, setAddPickerOpen] = useState(false)
  const [storageModal, setStorageModal] = useState<
    { mode: 'add' } | { mode: 'edit'; location: StorageLocation } | null
  >(null)
  const [view, setView] = useState<ViewMode>('flat')
  // Tracks collapsed sections rather than expanded ones -- an empty set
  // means every section starts expanded by default, with no need to know
  // location ids (which aren't loaded yet) at initial state.
  const [collapsedLocations, setCollapsedLocations] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!user?.id || !householdId) return
    const stored = localStorage.getItem(viewPrefKey(user.id, householdId))
    if (stored === 'flat' || stored === 'sectional') setView(stored)
  }, [user?.id, householdId])

  const changeView = (next: ViewMode) => {
    setView(next)
    if (user?.id && householdId) {
      localStorage.setItem(viewPrefKey(user.id, householdId), next)
    }
  }

  const toggleLocationCollapsed = (locationId: string) =>
    setCollapsedLocations((prev) => {
      const next = new Set(prev)
      if (next.has(locationId)) next.delete(locationId)
      else next.add(locationId)
      return next
    })

  const storageForm = useForm<StorageLocationForm>({ resolver: zodResolver(storageLocationSchema) })

  const openAddStorage = () => {
    storageForm.reset({ name: '', type: 'FRIDGE', description: '' })
    setStorageModal({ mode: 'add' })
  }

  const openEditStorage = (location: StorageLocation) => {
    storageForm.reset({
      name: location.name,
      type: location.type,
      description: location.description ?? '',
    })
    setStorageModal({ mode: 'edit', location })
  }

  const onSaveStorage = async (values: StorageLocationForm) => {
    setActionError(null)
    try {
      if (storageModal?.mode === 'edit') {
        await apiClient.patch(
          `/api/households/${householdId}/storage-locations/${storageModal.location.id}`,
          values,
        )
      } else {
        await apiClient.post(`/api/households/${householdId}/storage-locations`, values)
      }
      setStorageModal(null)
      // Not just reloadStorageLocations() -- each already-loaded item card
      // carries its own denormalized storage_location_name, so renaming a
      // location here would otherwise leave those cards showing the old
      // name until something unrelated happened to trigger a refetch.
      reloadAll()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const locationTypeById = useMemo(
    () => new Map((allStorageLocations ?? []).map((loc) => [loc.id, loc.type])),
    [allStorageLocations],
  )

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (items ?? []).filter((item) => {
      if (categoryFilter && item.category !== categoryFilter) return false
      if (storageTypeFilter && locationTypeById.get(item.storage_location_id) !== storageTypeFilter)
        return false
      if (
        term &&
        !item.food_type_name.toLowerCase().includes(term) &&
        !(item.name_override && item.name_override.toLowerCase().includes(term))
      )
        return false
      return true
    })
  }, [items, search, categoryFilter, storageTypeFilter, locationTypeById])

  // Grouping only makes sense while browsing, not while actively searching
  // -- typing a term flips back to a flat filtered list so every match is
  // visible at once instead of scattered across collapsed sections.
  const showSectional = view === 'sectional' && !storageLocationId && !search.trim()

  const groupedByLocation = useMemo(() => {
    const map = new Map<string, InventoryItem[]>()
    for (const item of filtered) {
      map.set(item.storage_location_id, [...(map.get(item.storage_location_id) ?? []), item])
    }
    return map
  }, [filtered])

  const noFiltersActive = !search.trim() && !categoryFilter && !storageTypeFilter

  // With no filters active, every location shows (even empty ones) so this
  // view can also stand in for "just browse my storage locations." Once a
  // filter narrows things down, empty locations just add noise, so only
  // locations with a matching item show.
  const sectionLocations = useMemo(() => {
    const all = allStorageLocations ?? []
    const relevant = noFiltersActive ? all : all.filter((loc) => groupedByLocation.has(loc.id))
    return [...relevant].sort((a, b) => a.name.localeCompare(b.name))
  }, [allStorageLocations, groupedByLocation, noFiltersActive])

  // `items` is already ACTIVE-only (see itemsUrl above), so these are plain
  // joins, no extra status filtering needed.
  const activeItemLocationById = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of items ?? []) map.set(item.id, item.storage_location_id)
    return map
  }, [items])

  const activeLocationsByVariant = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const item of items ?? []) {
      const set = map.get(item.household_food_variant_id) ?? new Set<string>()
      set.add(item.storage_location_id)
      map.set(item.household_food_variant_id, set)
    }
    return map
  }, [items])

  // Per-location warning badges. Expiry warnings map cleanly to a location
  // via their inventory_item_id. Stock warnings are variant-level, not
  // location-level -- LOW_STOCK can still be attributed to whichever
  // location(s) hold the remaining active stock, but OUT_OF_STOCK by
  // definition has zero active items anywhere, so there's no location to
  // attach it to. It still shows up in the header WarningsButton, just not
  // here.
  const locationWarningCounts = useMemo(() => {
    const counts = new Map<string, { critical: number; regular: number }>()
    const bump = (locationId: string, key: 'critical' | 'regular') => {
      const existing = counts.get(locationId) ?? { critical: 0, regular: 0 }
      existing[key] += 1
      counts.set(locationId, existing)
    }
    for (const w of warnings?.expiry_warnings ?? []) {
      const locationId = activeItemLocationById.get(w.inventory_item_id)
      if (locationId) bump(locationId, w.type === 'EXPIRED' ? 'critical' : 'regular')
    }
    for (const w of warnings?.stock_warnings ?? []) {
      if (w.type !== 'LOW_STOCK') continue
      for (const locationId of activeLocationsByVariant.get(w.household_food_variant_id) ?? []) {
        bump(locationId, 'regular')
      }
    }
    return counts
  }, [warnings, activeItemLocationById, activeLocationsByVariant])

  const startUsing = (itemId: string) => {
    setUsingItemId(itemId)
    setConsumeAmounts((prev) => ({ ...prev, [itemId]: '' }))
  }
  const cancelUsing = () => setUsingItemId(null)

  const consume = async (item: InventoryItem) => {
    const amount = consumeAmounts[item.id]
    if (!amount || Number(amount) <= 0) return
    setActionError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/inventory-items/${item.id}/consume`, {
        quantity_used: amount,
      })
      setConsumeAmounts((prev) => ({ ...prev, [item.id]: '' }))
      setUsingItemId(null)
      reloadAll()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const discard = async (item: InventoryItem, reason: RemovalReason) => {
    setActionError(null)
    try {
      await apiClient.delete(
        `/api/households/${householdId}/inventory-items/${item.id}?reason=${reason}`,
      )
      reloadAll()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  const renderItemCard = (item: InventoryItem) => {
    const expiry = item.expiry_date ? expiryText(item.expiry_date) : null
    const isUsing = usingItemId === item.id
    return (
      <li
        key={item.id}
        className="flex flex-col gap-3 rounded-card border border-subtle bg-surface p-4 shadow-card"
      >
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <CategoryDot category={item.category} />
            <span className="font-medium">{item.food_name}</span>
            {item.accounting_type !== 'PERSONAL' && (
              <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs text-muted">
                {ACCOUNTING_TYPE_LABELS[item.accounting_type]}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted">
            {item.quantity} / {item.total_quantity} {item.preferred_unit} ·{' '}
            {item.storage_location_name}
          </p>
          {expiry && (
            <p className={`text-xs ${expiry.expired ? 'text-danger' : 'text-faint'}`}>
              {expiry.text}
            </p>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-subtle pt-3">
          {isUsing ? (
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                step="any"
                autoFocus
                placeholder="Qty"
                className="w-16 rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
                value={consumeAmounts[item.id] ?? ''}
                onChange={(e) =>
                  setConsumeAmounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') consume(item)
                  if (e.key === 'Escape') cancelUsing()
                }}
              />
              <button
                type="button"
                onClick={() => consume(item)}
                className="rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
              >
                Confirm
              </button>
              <button
                type="button"
                onClick={cancelUsing}
                className="rounded-control p-2 text-faint transition-colors hover:bg-surface-hover hover:text-text"
                aria-label="Cancel"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => startUsing(item.id)}
              className="rounded-control bg-primary-soft px-2 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-bg"
            >
              Use
            </button>
          )}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="Mark expired"
              onClick={() => discard(item, 'EXPIRED')}
              className="rounded-control p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <CalendarX size={16} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title="Mark lost"
              onClick={() => discard(item, 'LOST')}
              className="rounded-control p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <HelpCircle size={16} strokeWidth={1.75} />
            </button>
            <button
              type="button"
              title="Discard"
              onClick={() => discard(item, 'DISCARDED')}
              className="rounded-control p-1.5 text-faint transition-colors hover:bg-danger-soft hover:text-danger"
            >
              <Trash2 size={16} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          {storageLocationId && (
            <Link
              to={`/households/${householdId}`}
              className="mb-1 flex items-center gap-1 text-xs font-medium text-muted hover:text-text"
            >
              <ArrowLeft size={14} strokeWidth={2} />
              Inventory
            </Link>
          )}
          <h2 className="text-xl font-semibold">
            {storageLocationId ? (storageLocation?.name ?? 'Storage location') : 'Inventory'}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <WarningsButton
            householdId={householdId ?? ''}
            stockWarnings={warnings?.stock_warnings ?? []}
            expiryWarnings={warnings?.expiry_warnings ?? []}
            onIgnored={reloadWarnings}
          />
          <button
            type="button"
            onClick={() =>
              storageLocationId
                ? navigate(`/households/${householdId}/inventory/add`)
                : setAddPickerOpen(true)
            }
            className="flex items-center gap-1.5 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
          >
            <Plus size={16} strokeWidth={2.25} />
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      <div className="sticky top-0 z-10 -mx-4 -mt-1 bg-bg px-4 pb-3 pt-1 md:-mx-8 md:px-8">
        <div className="flex flex-col gap-2 rounded-card border border-subtle bg-surface p-2 shadow-card sm:flex-row sm:items-center">
          <input
            type="text"
            placeholder="Search inventory…"
            className="min-w-0 flex-3 rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="relative flex-1">
            <UtensilsCrossed
              size={15}
              strokeWidth={1.75}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint"
            />
            <select
              className={`w-full rounded-control border bg-surface-2 py-2 pl-7 pr-2 text-sm text-text outline-none focus:border-primary ${
                categoryFilter ? FOOD_CATEGORY_BORDER_CLASSES[categoryFilter] : 'border-subtle'
              }`}
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as FoodCategory | '')}
            >
              <option value="">All food types</option>
              {FOOD_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {FOOD_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </div>
          {!storageLocationId && (
            <div className="relative flex-1">
              <MapPin
                size={15}
                strokeWidth={1.75}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-faint"
              />
              <select
                className={`w-full rounded-control border bg-surface-2 py-2 pl-7 pr-2 text-sm text-text outline-none focus:border-primary ${
                  storageTypeFilter ? STORAGE_TYPE_BORDER_CLASSES[storageTypeFilter] : 'border-subtle'
                }`}
                value={storageTypeFilter}
                onChange={(e) => setStorageTypeFilter(e.target.value as StorageLocationType | '')}
              >
                <option value="">All storage types</option>
                {STORAGE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {STORAGE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
          )}
          {!storageLocationId && (
            <div className="flex shrink-0 items-center gap-0.5 rounded-control border border-subtle bg-surface-2 p-0.5">
              <button
                type="button"
                onClick={() => changeView('flat')}
                title="Flat grid"
                aria-label="Flat grid view"
                aria-pressed={view === 'flat'}
                className={`rounded-control p-1.5 transition-colors ${
                  view === 'flat' ? 'bg-primary-soft text-primary' : 'text-faint hover:text-text'
                }`}
              >
                <LayoutGrid size={16} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                onClick={() => changeView('sectional')}
                title="Grouped by storage"
                aria-label="Grouped by storage view"
                aria-pressed={view === 'sectional'}
                className={`rounded-control p-1.5 transition-colors ${
                  view === 'sectional'
                    ? 'bg-primary-soft text-primary'
                    : 'text-faint hover:text-text'
                }`}
              >
                <Rows3 size={16} strokeWidth={1.75} />
              </button>
            </div>
          )}
        </div>
      </div>

      {(loadError || actionError) && (
        <p className="text-sm text-danger">{loadError ?? actionError}</p>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !items || items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
          <Package size={28} strokeWidth={1.5} className="text-faint" />
          <p className="text-sm text-muted">
            {storageLocationId ? 'Nothing stored here yet.' : 'Nothing in inventory yet.'}
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">No items match your search.</p>
      ) : showSectional ? (
        <div className="flex flex-col gap-5">
          {sectionLocations.map((loc) => {
            const locItems = groupedByLocation.get(loc.id) ?? []
            const isOpen = !collapsedLocations.has(loc.id)
            const locWarnings = locationWarningCounts.get(loc.id)
            return (
              <div
                key={loc.id}
                className="-mx-2 rounded-card px-2 py-2 transition-colors hover:bg-surface-hover"
              >
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleLocationCollapsed(loc.id)}
                    aria-label={isOpen ? 'Collapse section' : 'Expand section'}
                    className="shrink-0 rounded-control p-1 text-faint transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    {isOpen ? (
                      <ChevronDown size={16} strokeWidth={2} />
                    ) : (
                      <ChevronRight size={16} strokeWidth={2} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/households/${householdId}/storage/${loc.id}`)}
                    className="flex flex-1 items-center gap-2 overflow-hidden text-left"
                  >
                    <span className="truncate font-medium">{loc.name}</span>
                    <span
                      className={`shrink-0 rounded-pill px-2 py-0.5 text-xs font-medium ${STORAGE_TYPE_BADGE_CLASSES[loc.type]}`}
                    >
                      {STORAGE_TYPE_LABELS[loc.type]}
                    </span>
                    {locWarnings && (
                      <WarningCounts
                        critical={locWarnings.critical}
                        regular={locWarnings.regular}
                        size={13}
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditStorage(loc)}
                    aria-label="Edit storage location"
                    className="shrink-0 rounded-control p-1.5 text-faint transition-colors hover:bg-surface-hover hover:text-text"
                  >
                    <Pencil size={15} strokeWidth={1.75} />
                  </button>
                </div>
                <div className="mt-2 mb-3 border-b border-subtle" />
                {isOpen &&
                  (locItems.length === 0 ? (
                    <p className="text-sm text-muted">Nothing here yet.</p>
                  ) : (
                    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {locItems.map(renderItemCard)}
                    </ul>
                  ))}
              </div>
            )
          })}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(renderItemCard)}
        </ul>
      )}

      {addPickerOpen && (
        <Modal title="Add" onClose={() => setAddPickerOpen(false)}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              to={`/households/${householdId}/inventory/add`}
              onClick={() => setAddPickerOpen(false)}
              className={addChoiceClass}
            >
              <Package size={24} strokeWidth={1.5} />
              Item
            </Link>
            <button
              type="button"
              onClick={() => {
                setAddPickerOpen(false)
                openAddStorage()
              }}
              className={addChoiceClass}
            >
              <MapPin size={24} strokeWidth={1.5} />
              Storage
            </button>
          </div>
        </Modal>
      )}

      {storageModal && (
        <Modal
          title={storageModal.mode === 'edit' ? 'Edit storage location' : 'Add a storage location'}
          onClose={() => setStorageModal(null)}
        >
          <form onSubmit={storageForm.handleSubmit(onSaveStorage)} className="flex flex-col gap-3">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Name</label>
              <input
                type="text"
                placeholder="e.g. Garage Fridge"
                className={inputClass}
                {...storageForm.register('name')}
              />
              {storageForm.formState.errors.name && (
                <p className="mt-1.5 text-sm text-danger">
                  {storageForm.formState.errors.name.message}
                </p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">Type</label>
              <select className={inputClass} {...storageForm.register('type')}>
                {STORAGE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {STORAGE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-muted">
                Description (optional)
              </label>
              <input type="text" className={inputClass} {...storageForm.register('description')} />
            </div>
            <button
              type="submit"
              disabled={storageForm.formState.isSubmitting}
              className="mt-1 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              {storageForm.formState.isSubmitting
                ? 'Saving…'
                : storageModal.mode === 'edit'
                  ? 'Save changes'
                  : 'Add'}
            </button>
          </form>
        </Modal>
      )}
    </div>
  )
}
