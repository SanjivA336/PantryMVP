import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CalendarX, HelpCircle, Package, Plus, Trash2 } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { CategoryDot } from '../../components/CategoryDot'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import type {
  AccountingType,
  HouseholdWarnings,
  InventoryItem,
  RemovalReason,
} from '../../types/entities'
import { StockWarningsBanner } from './StockWarningsBanner'

const ACCOUNTING_TYPE_LABELS: Record<AccountingType, string> = {
  PERSONAL: 'Personal',
  SHARED_CONSUMABLE: 'Shared',
  UNIT_BASED: 'Unit-based',
}

export function InventoryPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const {
    data: items,
    loading,
    error: loadError,
    reload,
  } = useHouseholdResource<InventoryItem[]>(
    householdId ? `/api/households/${householdId}/inventory-items?status=ACTIVE` : null,
  )
  const { data: warnings, reload: reloadWarnings } = useHouseholdResource<HouseholdWarnings>(
    householdId ? `/api/households/${householdId}/warnings` : null,
  )
  // Another member consuming/adding/discarding an item on their own device
  // shows up here without a manual refresh -- one channel driving both
  // resources, rather than opening a second subscription to the same table.
  const reloadAll = useCallback(() => {
    reload()
    reloadWarnings()
  }, [reload, reloadWarnings])
  useRealtimeSubscription('inventory_items', householdId ?? null, reloadAll)
  const expiryWarningByItemId = new Map(
    (warnings?.expiry_warnings ?? []).map((w) => [w.inventory_item_id, w]),
  )
  const [actionError, setActionError] = useState<string | null>(null)
  const [consumeAmounts, setConsumeAmounts] = useState<Record<string, string>>({})

  const consume = async (item: InventoryItem) => {
    const amount = consumeAmounts[item.id]
    if (!amount || Number(amount) <= 0) return
    setActionError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/inventory-items/${item.id}/consume`, {
        quantity_used: amount,
      })
      setConsumeAmounts((prev) => ({ ...prev, [item.id]: '' }))
      reload()
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
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Inventory</h2>
        <Link
          to={`/households/${householdId}/inventory/add`}
          className="flex items-center gap-1.5 rounded-control bg-primary px-2 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover"
        >
          <Plus size={16} strokeWidth={2.25} />
          <span className="hidden sm:inline">Add item</span>
        </Link>
      </div>

      {(loadError || actionError) && (
        <p className="text-sm text-danger">{loadError ?? actionError}</p>
      )}

      <StockWarningsBanner stockWarnings={warnings?.stock_warnings ?? []} />

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : !items || items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
          <Package size={28} strokeWidth={1.5} className="text-faint" />
          <p className="text-sm text-muted">Nothing in inventory yet.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const expiryWarning = expiryWarningByItemId.get(item.id)
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
                  {item.expiry_date && (
                    <p className="text-xs text-faint">Expires {item.expiry_date}</p>
                  )}
                  {expiryWarning && (
                    <p
                      className={`mt-1.5 inline-flex rounded-pill px-2 py-0.5 text-xs font-medium ${
                        expiryWarning.type === 'EXPIRED'
                          ? 'bg-danger-soft text-danger'
                          : 'bg-warning-soft text-warning'
                      }`}
                    >
                      {expiryWarning.type === 'EXPIRED'
                        ? `Expired ${Math.abs(expiryWarning.days_until)} day(s) ago`
                        : expiryWarning.days_until === 0
                          ? 'Expires today'
                          : `Expires in ${expiryWarning.days_until} day(s)`}
                    </p>
                  )}
                </div>

                <div className="mt-auto flex items-center justify-between gap-2 border-t border-subtle pt-3">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      step="any"
                      placeholder="Qty"
                      className="w-16 rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
                      value={consumeAmounts[item.id] ?? ''}
                      onChange={(e) =>
                        setConsumeAmounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => consume(item)}
                      className="rounded-control bg-primary-soft px-2 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-bg"
                    >
                      Use
                    </button>
                  </div>
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
          })}
        </ul>
      )}
    </div>
  )
}
