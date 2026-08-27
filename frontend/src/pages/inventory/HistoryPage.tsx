import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Clock } from 'lucide-react'
import { useHouseholdResource } from '../../hooks/useHouseholdResource'
import { CategoryDot } from '../../components/CategoryDot'
import { UNIT_LABELS } from '../../lib/units'
import type { InventoryItem, InventoryItemStatus } from '../../types/entities'

// Not an audit log -- a browsable ledger of every purchase ever logged for
// this household (active or not), so a mistake can be found and corrected
// after the fact. Built on the same unfiltered GET the current-inventory
// view uses with a status filter -- omitting the filter here is what turns
// it into full history instead of "what's on the shelf right now".
const STATUS_LABELS: Record<InventoryItemStatus, string> = {
  ACTIVE: 'Active',
  EMPTY: 'Used up',
  DISCARDED: 'Discarded',
  EXPIRED: 'Expired',
  LOST: 'Lost',
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function HistoryPage() {
  const { householdId } = useParams<{ householdId: string }>()
  const {
    data: items,
    loading,
    error,
  } = useHouseholdResource<InventoryItem[]>(
    householdId ? `/api/households/${householdId}/inventory-items` : null,
  )
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!items) return []
    const query = search.trim().toLowerCase()
    if (!query) return items
    return items.filter((item) => item.food_name.toLowerCase().includes(query))
  }, [items, search])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold">History</h2>
        <p className="mt-1 text-sm text-muted">
          Every purchase this household has ever logged. Click one to fix a mistake.
        </p>
      </div>

      <input
        type="text"
        placeholder="Search history…"
        className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none placeholder:text-faint focus:border-primary"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <p className="text-sm text-danger">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-subtle p-10 text-center">
          <Clock size={28} strokeWidth={1.5} className="text-faint" />
          <p className="text-sm text-muted">Nothing here yet.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((item) => (
            <li key={item.id}>
              <Link
                to={`/households/${householdId}/inventory-items/${item.id}`}
                className="flex items-center justify-between gap-3 rounded-card border border-subtle bg-surface px-4 py-3 shadow-card transition-colors hover:border-subtle-strong hover:bg-surface-hover"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <CategoryDot category={item.category} />
                  <div className="min-w-0">
                    <p className="truncate font-medium">{item.food_name}</p>
                    <p className="text-xs text-faint">
                      {item.total_quantity} {UNIT_LABELS[item.preferred_unit]} · ${item.cost} ·{' '}
                      {formatDate(item.purchased_at)}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.debt_frozen_at === null && item.accounting_type !== 'PERSONAL' && (
                    <span className="rounded-pill bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                      Pending
                    </span>
                  )}
                  <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-xs text-muted">
                    {STATUS_LABELS[item.status]}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
