import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { apiClient, ApiError } from '../../lib/apiClient'
import { Modal } from '../../components/Modal'
import { guessDimension, UNIT_LABELS, UNITS_BY_DIMENSION } from '../../lib/units'
import type { Dimension, InventoryItem, Unit } from '../../types/entities'

interface Props {
  item: InventoryItem
  householdId: string
  onClose: () => void
  onConsumed: () => void
}

// Rough real-world portions -> a concrete amount in a concrete unit. Picking
// one fills the quantity + unit fields directly (both editable before
// submit), so "a bowl" never pretends to be an exact measurement -- it's a
// starting point. COUNT gets none of these: a count item is already counted.
const NAMED_PRESETS: Record<
  Exclude<Dimension, 'COUNT'>,
  { label: string; unit: Unit; amount: number }[]
> = {
  VOLUME: [
    { label: 'Splash', unit: 'ml', amount: 15 },
    { label: 'Glass', unit: 'ml', amount: 250 },
    { label: 'Mug', unit: 'ml', amount: 350 },
    { label: 'Bowl', unit: 'ml', amount: 400 },
    { label: 'Cup', unit: 'cup', amount: 1 },
  ],
  WEIGHT: [
    { label: 'Pinch', unit: 'g', amount: 1 },
    { label: 'Handful', unit: 'g', amount: 30 },
    { label: 'Slice', unit: 'g', amount: 30 },
    { label: 'Stick', unit: 'g', amount: 113 },
  ],
}

const FRACTIONS: { label: string; divisor: number }[] = [
  { label: 'All of it', divisor: 1 },
  { label: 'Half', divisor: 2 },
  { label: 'A third', divisor: 3 },
  { label: 'A quarter', divisor: 4 },
]

const presetButtonClass =
  'rounded-control border border-subtle bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-surface-hover hover:text-text'

export function UseItemModal({ item, householdId, onClose, onConsumed }: Props) {
  const dimension = guessDimension(item.preferred_unit)
  const remaining = Number(item.quantity)
  const total = Number(item.total_quantity)
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0

  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState<Unit>(item.preferred_unit)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const bump = (delta: number) => {
    const next = (Number(amount) || 0) + delta
    setAmount(next > 0 ? String(next) : '')
  }

  // Fractions always work off what's left, in the item's own unit -- reset
  // the unit selector to match so the number that lands means what it says.
  const applyFraction = (divisor: number) => {
    let value = remaining / divisor
    if (dimension === 'COUNT') value = Math.max(1, Math.round(value))
    setUnit(item.preferred_unit)
    setAmount(String(Number(value.toFixed(3))))
  }

  const applyNamedPreset = (preset: { unit: Unit; amount: number }) => {
    setUnit(preset.unit)
    setAmount(String(preset.amount))
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
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-pill bg-surface-2">
            <div className="h-full rounded-pill bg-primary" style={{ width: `${pct}%` }} />
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

        <div className="flex flex-wrap gap-1.5">
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

        {dimension !== 'COUNT' && (
          <div>
            <p className="mb-1.5 text-xs text-faint">About this much</p>
            <div className="flex flex-wrap gap-1.5">
              {NAMED_PRESETS[dimension].map((p) => (
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

        <div className="flex gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={submit}
            className="rounded-control bg-primary px-3 py-2 text-sm font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {submitting ? 'Saving…' : 'Use it'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control px-3 py-2 text-sm font-medium text-muted hover:bg-surface-hover"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}
