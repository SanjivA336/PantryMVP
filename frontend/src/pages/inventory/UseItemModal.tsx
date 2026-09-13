import { useMemo, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { Modal } from '../../components/Modal'
import { convertAmount, guessDimension, UNIT_LABELS, UNITS_BY_DIMENSION } from '../../lib/units'
import type { Dimension, InventoryItem, Unit } from '../../types/entities'

interface Props {
  item: InventoryItem
  householdId: string
  onClose: () => void
  onConsumed: () => void
}

// Rough real-world portions -> a concrete amount, defined in whatever unit
// reads most naturally for that portion. Picking one fills the "Amount
// used" field, converted into whichever unit the user currently has
// selected -- it's a starting point, not a claim that "a bowl" is an exact
// measurement, and it never yanks the unit picker out from under someone
// who already switched units. COUNT gets none of these: a count item is
// already counted. Declared in no particular order; sorted by actual size
// (smallest first) at render time so re-ordering this list never requires
// re-ordering it by hand too.
const NAMED_PRESETS: Record<
  Exclude<Dimension, 'COUNT'>,
  { label: string; unit: Unit; amount: number }[]
> = {
  VOLUME: [
    { label: 'Splash', unit: 'ml', amount: 15 },
    { label: 'Cup', unit: 'cup', amount: 1 },
    { label: 'Glass', unit: 'ml', amount: 250 },
    { label: 'Mug', unit: 'ml', amount: 350 },
    { label: 'Bowl', unit: 'ml', amount: 400 },
  ],
  // Deliberately just these two -- "slice" and "stick" describe a specific
  // food's own packaging (bread, butter) rather than a rough amount that
  // makes sense for any weighed food, so they don't belong in a generic list.
  WEIGHT: [
    { label: 'Pinch', unit: 'g', amount: 1 },
    { label: 'Handful', unit: 'g', amount: 30 },
  ],
}

const FRACTIONS: { label: string; divisor: number }[] = [
  { label: '¼', divisor: 4 },
  { label: '⅓', divisor: 3 },
  { label: '½', divisor: 2 },
  { label: 'All', divisor: 1 },
]

const presetButtonClass =
  'rounded-control border border-subtle bg-surface-2 px-2 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text'

function gridStyle(count: number) {
  return { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }
}

export function UseItemModal({ item, householdId, onClose, onConsumed }: Props) {
  const dimension = guessDimension(item.preferred_unit)
  const remaining = Number(item.quantity)
  const total = Number(item.total_quantity)

  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<Unit>(item.preferred_unit)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Everything the bar needs, in the *display* unit (whatever's currently
  // selected) so the planned-use segment lines up with the number the user
  // is actually looking at in the amount field.
  const remainingInUnit = convertAmount(remaining, item.preferred_unit, unit)
  const totalInUnit = convertAmount(total, item.preferred_unit, unit)
  const planned = Math.max(0, Math.min(Number(amount) || 0, remainingInUnit))
  const remainingPct = totalInUnit > 0 ? (remainingInUnit / totalInUnit) * 100 : 0
  const plannedPct = totalInUnit > 0 ? (planned / totalInUnit) * 100 : 0

  const namedPresets = dimension === 'COUNT' ? [] : NAMED_PRESETS[dimension]
  const sortedNamedPresets = useMemo(
    () =>
      [...namedPresets].sort(
        (a, b) => convertAmount(a.amount, a.unit, 'g') - convertAmount(b.amount, b.unit, 'g'),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dimension],
  )

  const bump = (delta: number) => {
    const next = (Number(amount) || 0) + delta
    setAmount(next > 0 ? String(next) : '')
  }

  // Fractions work off what's left, expressed in whichever unit is
  // currently selected -- never forces the unit picker back to the item's
  // own preferred unit just because a fraction was clicked.
  const applyFraction = (divisor: number) => {
    let value = remainingInUnit / divisor
    if (dimension === 'COUNT') value = Math.max(1, Math.round(value))
    setAmount(String(Number(value.toFixed(3))))
  }

  const applyNamedPreset = (preset: { unit: Unit; amount: number }) => {
    const value = convertAmount(preset.amount, preset.unit, unit)
    setAmount(String(Number(value.toFixed(3))))
  }

  const submit = async () => {
    const n = Number(amount)
    if (!amount || n <= 0) {
      setError('Enter an amount greater than zero.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await apiClient.post(`/api/households/${householdId}/inventory-items/${item.id}/consume`, {
        quantity_used: amount,
        unit,
      })
      onConsumed()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title={`Use ${item.food_name}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-muted">Remaining</span>
            <span className="font-medium">
              {Number(remaining.toFixed(3))} of {Number(total.toFixed(3))}{' '}
              {UNIT_LABELS[item.preferred_unit]}
            </span>
          </div>
          {/* Three-layer bar, all anchored to the left edge and stacked on
              top of each other: the track itself (darkest) is the total;
              green on top of it is what's currently left; blue on top of
              that grows from zero as the amount field changes, showing how
              much of the remaining green this use would take. */}
          <div className="relative mt-1.5 h-2.5 w-full overflow-hidden rounded-pill bg-bg">
            <div
              className="absolute inset-y-0 left-0 rounded-pill bg-primary transition-all duration-200 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, remainingPct))}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 rounded-pill bg-info transition-all duration-200 ease-out"
              style={{ width: `${Math.max(0, Math.min(100, plannedPct))}%` }}
            />
          </div>
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="mb-1.5 block text-sm font-medium text-muted">Amount used</label>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => bump(-1)}
                aria-label="Decrease by one"
                className="rounded-control border border-subtle p-2 text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <Minus size={14} strokeWidth={2} />
              </button>
              <input
                type="number"
                step="any"
                min="0"
                autoFocus
                className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-center text-sm text-text outline-none focus:border-primary"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submit()
                }}
              />
              <button
                type="button"
                onClick={() => bump(1)}
                aria-label="Increase by one"
                className="rounded-control border border-subtle p-2 text-muted transition-colors hover:bg-surface-hover hover:text-text"
              >
                <Plus size={14} strokeWidth={2} />
              </button>
            </div>
          </div>
          <div className="w-24">
            <label className="mb-1.5 block text-sm font-medium text-muted">Unit</label>
            <select
              className="w-full rounded-control border border-subtle bg-surface-2 px-2 py-2 text-sm text-text outline-none focus:border-primary"
              value={unit}
              onChange={(e) => setUnit(e.target.value as Unit)}
            >
              {UNITS_BY_DIMENSION[dimension].map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABELS[u]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-1.5" style={gridStyle(FRACTIONS.length)}>
          {FRACTIONS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => applyFraction(f.divisor)}
              className={presetButtonClass}
            >
              {f.label}
            </button>
          ))}
        </div>

        {sortedNamedPresets.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs text-faint">About this much</p>
            <div className="grid gap-1.5" style={gridStyle(sortedNamedPresets.length)}>
              {sortedNamedPresets.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyNamedPreset(p)}
                  className={presetButtonClass}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="button"
          disabled={submitting}
          onClick={submit}
          className="w-full rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {submitting ? 'Saving…' : 'Use it'}
        </button>
      </div>
    </Modal>
  )
}
