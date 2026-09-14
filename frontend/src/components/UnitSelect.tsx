import { DIMENSION_LABELS, UNITS_BY_DIMENSION, UNIT_LABELS } from '../lib/units'
import type { Dimension, Unit } from '../types/entities'

const ALL_DIMENSIONS: Dimension[] = ['WEIGHT', 'VOLUME', 'COUNT']

interface Props {
  value: Unit | ''
  onChange: (unit: Unit) => void
  // Restrict which dimensions' units are offered -- omit for the full
  // picker (any unit, grouped into Weight/Volume/Count sections), or pass
  // just the item's own dimension once it's fixed (editing an existing
  // item can only swap within its dimension, so a single flat list without
  // section headers reads better there than one lonely optgroup).
  dimensions?: Dimension[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

// One dropdown for every unit picker in the app -- grouped into Weight/
// Volume/Count sections via native <optgroup> when more than one dimension
// is offered, so picking an exact unit (not just a dimension) is always a
// single action instead of a two-step dimension-then-system chooser.
export function UnitSelect({
  value,
  onChange,
  dimensions = ALL_DIMENSIONS,
  placeholder,
  disabled,
  className,
}: Props) {
  const grouped = dimensions.length > 1

  return (
    <select
      disabled={disabled}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value as Unit)}
    >
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {dimensions.map((dim) => {
        const options = UNITS_BY_DIMENSION[dim].map((u) => (
          <option key={u} value={u}>
            {UNIT_LABELS[u]}
          </option>
        ))
        return grouped ? (
          <optgroup key={dim} label={DIMENSION_LABELS[dim]}>
            {options}
          </optgroup>
        ) : (
          options
        )
      })}
    </select>
  )
}
