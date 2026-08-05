import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, TriangleAlert } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { Modal } from '../../components/Modal'
import { WarningCounts } from '../../components/WarningCounts'
import type { ExpiryWarning, StockWarning } from '../../types/entities'

interface Props {
  householdId: string
  stockWarnings: StockWarning[]
  expiryWarnings: ExpiryWarning[]
  onIgnored: () => void
}

type GroupKey = 'OUT_OF_STOCK' | 'EXPIRED' | 'LOW_STOCK' | 'EXPIRING_SOON'

interface Row {
  key: string
  name: string
  description: string
  onIgnore: () => void
}

// Critical groups (red) always sort ahead of regular ones (yellow); within
// each severity there's no further ordering the user specified.
const GROUP_ORDER: GroupKey[] = ['OUT_OF_STOCK', 'EXPIRED', 'LOW_STOCK', 'EXPIRING_SOON']
const GROUP_SEVERITY: Record<GroupKey, 'critical' | 'regular'> = {
  OUT_OF_STOCK: 'critical',
  EXPIRED: 'critical',
  LOW_STOCK: 'regular',
  EXPIRING_SOON: 'regular',
}

function groupLabel(key: GroupKey, n: number): string {
  const item = n === 1 ? 'item' : 'items'
  switch (key) {
    case 'OUT_OF_STOCK':
      return `${n} ${item} out of stock`
    case 'EXPIRED':
      return `${n} ${item} expired`
    case 'LOW_STOCK':
      return `${n} ${item} running low`
    case 'EXPIRING_SOON':
      return `${n} ${item} expiring soon`
  }
}

export function WarningsButton({ householdId, stockWarnings, expiryWarnings, onIgnored }: Props) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<GroupKey>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)

  const criticalCount =
    stockWarnings.filter((w) => w.type === 'OUT_OF_STOCK').length +
    expiryWarnings.filter((w) => w.type === 'EXPIRED').length
  const regularCount =
    stockWarnings.filter((w) => w.type === 'LOW_STOCK').length +
    expiryWarnings.filter((w) => w.type === 'EXPIRING_SOON').length
  const hasWarnings = criticalCount + regularCount > 0

  const toggleGroup = (key: GroupKey) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const ignoreStock = useCallback(
    // referenceUnit picks out which dimension's warning is being dismissed
    // -- a food with stock split across e.g. both weight and volume (see
    // "separate stock lines") can have two independent warnings at once,
    // and ignoring one must not silently suppress the other.
    async (variantId: string, referenceUnit: string) => {
      setActionError(null)
      try {
        await apiClient.post(
          `/api/households/${householdId}/warnings/stock/${variantId}/ignore?reference_unit=${encodeURIComponent(referenceUnit)}`,
        )
        onIgnored()
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
      }
    },
    [householdId, onIgnored],
  )

  const ignoreExpiry = useCallback(
    async (itemId: string) => {
      setActionError(null)
      try {
        await apiClient.post(`/api/households/${householdId}/warnings/expiry/${itemId}/ignore`)
        onIgnored()
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Something went wrong')
      }
    },
    [householdId, onIgnored],
  )

  // Building this runs eight filter/map passes over the two warning
  // arrays -- cheap at typical list sizes, but pure waste to redo on every
  // render (including while the modal isn't even open), so it's only
  // recomputed when the underlying warnings actually change.
  const groups: Record<GroupKey, Row[]> = useMemo(
    () => ({
      OUT_OF_STOCK: stockWarnings
        .filter((w) => w.type === 'OUT_OF_STOCK')
        .map((w) => ({
          // Includes the unit -- a variant can have two separate stock
          // warnings at once (e.g. weight and volume), so the variant id
          // alone isn't a unique key here.
          key: `${w.household_food_variant_id}-${w.preferred_unit}`,
          name: w.food_name,
          description: `You had ${w.reference_quantity} ${w.preferred_unit} last time -- none left now.`,
          onIgnore: () => ignoreStock(w.household_food_variant_id, w.preferred_unit),
        })),
      LOW_STOCK: stockWarnings
        .filter((w) => w.type === 'LOW_STOCK')
        .map((w) => ({
          key: `${w.household_food_variant_id}-${w.preferred_unit}`,
          name: w.food_name,
          description: `${w.remaining_quantity} ${w.preferred_unit} left, out of ${w.reference_quantity} last purchased.`,
          onIgnore: () => ignoreStock(w.household_food_variant_id, w.preferred_unit),
        })),
      EXPIRED: expiryWarnings
        .filter((w) => w.type === 'EXPIRED')
        .map((w) => {
          const n = Math.abs(w.days_until)
          return {
            key: w.inventory_item_id,
            name: w.food_name,
            description: `Expired on ${w.relevant_date} (${n} day${n === 1 ? '' : 's'} ago) · ${w.storage_location_name}`,
            onIgnore: () => ignoreExpiry(w.inventory_item_id),
          }
        }),
      EXPIRING_SOON: expiryWarnings
        .filter((w) => w.type === 'EXPIRING_SOON')
        .map((w) => ({
          key: w.inventory_item_id,
          name: w.food_name,
          description: `Expires on ${w.relevant_date} (${w.days_until} day${w.days_until === 1 ? '' : 's'}) · ${w.storage_location_name}`,
          onIgnore: () => ignoreExpiry(w.inventory_item_id),
        })),
    }),
    [stockWarnings, expiryWarnings, ignoreStock, ignoreExpiry],
  )

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={hasWarnings ? 'View warnings' : 'No warnings'}
        className={`flex items-center gap-2 rounded-control border border-subtle px-2 py-2 text-sm font-semibold transition-colors ${
          hasWarnings
            ? 'bg-surface hover:bg-surface-hover'
            : 'bg-surface-2 text-faint hover:bg-surface-hover'
        }`}
      >
        {hasWarnings ? (
          <WarningCounts critical={criticalCount} regular={regularCount} />
        ) : (
          <TriangleAlert size={16} strokeWidth={1.75} />
        )}
      </button>

      {open && (
        <Modal title="Warnings" onClose={() => setOpen(false)}>
          {actionError && <p className="mb-2 text-sm text-danger">{actionError}</p>}
          {!hasWarnings && (
            <p className="text-sm text-muted">No warnings right now.</p>
          )}
          <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto">
            {GROUP_ORDER.filter((key) => groups[key].length > 0).map((key) => {
              const rows = groups[key]
              const isOpen = expanded.has(key)
              const severity = GROUP_SEVERITY[key]
              return (
                <div key={key} className="rounded-control border border-subtle">
                  <button
                    type="button"
                    onClick={() => toggleGroup(key)}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium ${
                      severity === 'critical' ? 'text-danger' : 'text-warning'
                    }`}
                  >
                    {groupLabel(key, rows.length)}
                    {isOpen ? (
                      <ChevronUp size={16} strokeWidth={2} />
                    ) : (
                      <ChevronDown size={16} strokeWidth={2} />
                    )}
                  </button>
                  {isOpen && (
                    <ul className="flex flex-col gap-1.5 border-t border-subtle p-2">
                      {rows.map((row) => (
                        <li
                          key={row.key}
                          className="flex items-start justify-between gap-2 rounded-control bg-surface-2 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-text">{row.name}</p>
                            <p className="text-xs text-faint">{row.description}</p>
                          </div>
                          <button
                            type="button"
                            onClick={row.onIgnore}
                            className="shrink-0 rounded-control px-2 py-1 text-xs font-medium text-faint transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            Ignore
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </Modal>
      )}
    </>
  )
}
