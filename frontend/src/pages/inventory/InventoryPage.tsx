import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiClient, ApiError } from '../../lib/apiClient'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription'
import type { AccountingType, InventoryItem, RemovalReason } from '../../types/entities'

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
  // Another member consuming/adding/discarding an item on their own device
  // shows up here without a manual refresh.
  useRealtimeSubscription('inventory_items', householdId ?? null, reload)
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Inventory</h2>
        <Link
          to={`/households/${householdId}/inventory/add`}
          className="rounded-md px-3 py-2 text-sm font-medium text-white"
          style={{ backgroundColor: 'var(--color-primary)' }}
        >
          + Add item
        </Link>
      </div>

      {(loadError || actionError) && (
        <p className="text-sm text-red-600">{loadError ?? actionError}</p>
      )}

      {loading ? (
        <p className="text-sm">Loading…</p>
      ) : !items || items.length === 0 ? (
        <p className="text-sm text-gray-500">Nothing in inventory yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-gray-200 bg-white p-4">
              <div className="flex items-start justify-between">
                <div>
                  <span className="font-medium">{item.food_name}</span>
                  {item.accounting_type !== 'PERSONAL' && (
                    <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                      {ACCOUNTING_TYPE_LABELS[item.accounting_type]}
                    </span>
                  )}
                  <p className="text-sm text-gray-500">
                    {item.quantity} / {item.total_quantity} {item.preferred_unit} —{' '}
                    {item.storage_location_name}
                  </p>
                  {item.expiry_date && (
                    <p className="text-xs text-gray-400">Expires {item.expiry_date}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="any"
                      placeholder="Amount"
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={consumeAmounts[item.id] ?? ''}
                      onChange={(e) =>
                        setConsumeAmounts((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      onClick={() => consume(item)}
                      className="rounded-md px-2 py-1 text-sm font-medium text-white"
                      style={{ backgroundColor: 'var(--color-primary)' }}
                    >
                      Use
                    </button>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => discard(item, 'EXPIRED')}
                      className="text-red-600 hover:underline"
                    >
                      Expired
                    </button>
                    <button
                      type="button"
                      onClick={() => discard(item, 'LOST')}
                      className="text-red-600 hover:underline"
                    >
                      Lost
                    </button>
                    <button
                      type="button"
                      onClick={() => discard(item, 'DISCARDED')}
                      className="text-red-600 hover:underline"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
