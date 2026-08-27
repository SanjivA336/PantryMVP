import type { Dimension, Unit, UnitSystem } from '../types/entities'

// Every unit in the closed vocabulary (mirrors backend/app/schemas/units.py's
// Unit enum), grouped by dimension -- the source for every unit <select> in
// the app (recipe ingredients, receipt review, new-food-type creation).
export const UNITS_BY_DIMENSION: Record<Dimension, Unit[]> = {
  WEIGHT: ['g', 'kg', 'oz', 'lb'],
  VOLUME: ['ml', 'l', 'tsp', 'tbsp', 'fl_oz', 'cup', 'pt', 'qt', 'gal'],
  COUNT: ['count'],
}

export const ALL_UNITS: Unit[] = [
  ...UNITS_BY_DIMENSION.WEIGHT,
  ...UNITS_BY_DIMENSION.VOLUME,
  ...UNITS_BY_DIMENSION.COUNT,
]

// Display label for each unit -- short, since these show up inline next to
// a quantity ("2 fl oz"), not spelled out in full ("2 fluid ounces").
export const UNIT_LABELS: Record<Unit, string> = {
  g: 'g',
  kg: 'kg',
  oz: 'oz',
  lb: 'lb',
  ml: 'ml',
  l: 'l',
  tsp: 'tsp',
  tbsp: 'tbsp',
  fl_oz: 'fl oz',
  cup: 'cup',
  pt: 'pt',
  qt: 'qt',
  gal: 'gal',
  count: 'count',
}

const UNIT_DIMENSION: Record<Unit, Dimension> = {
  g: 'WEIGHT',
  kg: 'WEIGHT',
  oz: 'WEIGHT',
  lb: 'WEIGHT',
  ml: 'VOLUME',
  l: 'VOLUME',
  tsp: 'VOLUME',
  tbsp: 'VOLUME',
  fl_oz: 'VOLUME',
  cup: 'VOLUME',
  pt: 'VOLUME',
  qt: 'VOLUME',
  gal: 'VOLUME',
  count: 'COUNT',
}

// COUNT deliberately absent -- no metric/customary distinction.
const UNIT_SYSTEM: Partial<Record<Unit, UnitSystem>> = {
  g: 'METRIC',
  kg: 'METRIC',
  ml: 'METRIC',
  l: 'METRIC',
  oz: 'CUSTOMARY',
  lb: 'CUSTOMARY',
  tsp: 'CUSTOMARY',
  tbsp: 'CUSTOMARY',
  fl_oz: 'CUSTOMARY',
  cup: 'CUSTOMARY',
  pt: 'CUSTOMARY',
  qt: 'CUSTOMARY',
  gal: 'CUSTOMARY',
}

// Mirrors backend/app/services/units.py's CANONICAL_UNIT -- the one unit the
// Add Item picker itself ever writes for each (dimension, system) pair. Kept
// deliberately small (one unit per pair, not e.g. a g-vs-kg choice within
// metric) so the picker is just two toggles: Weight/Volume/Count and
// Metric/Customary.
export const CANONICAL_UNIT: Record<Dimension, Record<UnitSystem, Unit> | null> = {
  WEIGHT: { METRIC: 'g', CUSTOMARY: 'oz' },
  VOLUME: { METRIC: 'ml', CUSTOMARY: 'cup' },
  COUNT: null,
}

export function resolveUnit(dimension: Dimension, system: UnitSystem | null): Unit {
  if (dimension === 'COUNT') return 'count'
  return CANONICAL_UNIT[dimension]![system ?? 'CUSTOMARY']
}

// Every Unit has exactly one, fixed dimension/system -- these are plain
// lookups, not guesses, now that unit fields are a closed enum instead of
// free text (kept under their original names to avoid churning every call
// site written when this genuinely did guess at free text).
export function guessDimension(unit: Unit): Dimension {
  return UNIT_DIMENSION[unit]
}

export function guessSystem(unit: Unit): UnitSystem | null {
  return UNIT_SYSTEM[unit] ?? null
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
