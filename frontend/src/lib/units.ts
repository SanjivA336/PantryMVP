import type { Dimension, UnitSystem } from '../types/entities'

// Mirrors backend/app/services/units.py's CANONICAL_UNIT -- the one unit the
// Add Item picker itself ever writes for each (dimension, system) pair. Kept
// deliberately small (one unit per pair, not e.g. a g-vs-kg choice within
// metric) so the picker is just two toggles: Weight/Volume/Count and
// Metric/Customary.
export const CANONICAL_UNIT: Record<Dimension, Record<UnitSystem, string> | null> = {
  WEIGHT: { METRIC: 'g', CUSTOMARY: 'oz' },
  VOLUME: { METRIC: 'ml', CUSTOMARY: 'cup' },
  COUNT: null,
}

export function resolveUnit(dimension: Dimension, system: UnitSystem | null): string {
  if (dimension === 'COUNT') return 'count'
  return CANONICAL_UNIT[dimension]![system ?? 'CUSTOMARY']
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  WEIGHT: 'Weight',
  VOLUME: 'Volume',
  COUNT: 'Count',
}

export const UNIT_SYSTEM_LABELS: Record<UnitSystem, string> = {
  METRIC: 'Metric',
  CUSTOMARY: 'Customary',
}

// Shown next to the Metric/Customary toggle so picking one means something
// concrete instead of an abstract label -- e.g. in household settings, when
// there's no specific food (and so no dimension) to resolve a single unit
// from yet.
export const UNIT_SYSTEM_EXAMPLES: Record<UnitSystem, string> = {
  METRIC: 'grams, milliliters',
  CUSTOMARY: 'ounces, cups',
}
