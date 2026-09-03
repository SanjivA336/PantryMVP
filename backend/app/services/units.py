from decimal import ROUND_HALF_UP, Decimal

from app.schemas.units import Dimension, Unit, UnitSystem

# The precision the API has always exposed for a stored quantity
# (inventory_items.quantity was numeric(10,3) before migration 0028).
# from_base results are rounded to this at the read edge and nowhere else.
_DISPLAY_QUANTUM = Decimal("0.001")

# Base unit per dimension: grams for weight, milliliters for volume, plain
# count for count. Every unit's factor converts 1 of that unit into this
# base -- e.g. 1 oz = 28.3495 base units (grams).
#
# This intentionally recognizes more units than the Add Item picker offers
# (kg, lb, tbsp, tsp, fl_oz, pt, qt, gal) -- existing data written before a
# given unit was addable this way, or a food's own catalog default, may
# still use them, and they should still convert/sum correctly even though
# new entries only ever pick from CANONICAL_UNIT below.
_TO_BASE: dict[Unit, Decimal] = {
    Unit.G: Decimal("1"),
    Unit.KG: Decimal("1000"),
    Unit.OZ: Decimal("28.3495"),
    Unit.LB: Decimal("453.592"),
    Unit.ML: Decimal("1"),
    Unit.L: Decimal("1000"),
    Unit.CUP: Decimal("236.588"),
    Unit.TBSP: Decimal("14.7868"),
    Unit.TSP: Decimal("4.92892"),
    Unit.FL_OZ: Decimal("29.5735"),
    Unit.PT: Decimal("473.176"),
    Unit.QT: Decimal("946.353"),
    Unit.GAL: Decimal("3785.41"),
    Unit.COUNT: Decimal("1"),
}

_UNIT_DIMENSION: dict[Unit, Dimension] = {
    Unit.G: Dimension.WEIGHT,
    Unit.KG: Dimension.WEIGHT,
    Unit.OZ: Dimension.WEIGHT,
    Unit.LB: Dimension.WEIGHT,
    Unit.ML: Dimension.VOLUME,
    Unit.L: Dimension.VOLUME,
    Unit.CUP: Dimension.VOLUME,
    Unit.TBSP: Dimension.VOLUME,
    Unit.TSP: Dimension.VOLUME,
    Unit.FL_OZ: Dimension.VOLUME,
    Unit.PT: Dimension.VOLUME,
    Unit.QT: Dimension.VOLUME,
    Unit.GAL: Dimension.VOLUME,
    Unit.COUNT: Dimension.COUNT,
}

_UNIT_SYSTEM: dict[Unit, UnitSystem] = {
    Unit.G: UnitSystem.METRIC,
    Unit.KG: UnitSystem.METRIC,
    Unit.ML: UnitSystem.METRIC,
    Unit.L: UnitSystem.METRIC,
    Unit.OZ: UnitSystem.CUSTOMARY,
    Unit.LB: UnitSystem.CUSTOMARY,
    Unit.CUP: UnitSystem.CUSTOMARY,
    Unit.TBSP: UnitSystem.CUSTOMARY,
    Unit.TSP: UnitSystem.CUSTOMARY,
    Unit.FL_OZ: UnitSystem.CUSTOMARY,
    Unit.PT: UnitSystem.CUSTOMARY,
    Unit.QT: UnitSystem.CUSTOMARY,
    Unit.GAL: UnitSystem.CUSTOMARY,
    # COUNT deliberately absent -- no metric/customary distinction.
}

# The one unit the app itself writes for each (dimension, system) pair. Only
# these five ever come out of the Add Item picker; the wider recognized set
# above exists purely to keep older/foreign data comparable.
CANONICAL_UNIT: dict[tuple[Dimension, UnitSystem], Unit] = {
    (Dimension.WEIGHT, UnitSystem.METRIC): Unit.G,
    (Dimension.WEIGHT, UnitSystem.CUSTOMARY): Unit.OZ,
    (Dimension.VOLUME, UnitSystem.METRIC): Unit.ML,
    (Dimension.VOLUME, UnitSystem.CUSTOMARY): Unit.CUP,
}


# The unit every stored quantity is actually persisted in, per dimension
# (see migration 0028). Grams / millilitres / count -- so a lost or
# corrupted display_unit is a cosmetic problem, never a "what does this
# number mean" one, and all same-dimension math is a plain add with no
# conversion in the middle.
_BASE_UNIT: dict[Dimension, Unit] = {
    Dimension.WEIGHT: Unit.G,
    Dimension.VOLUME: Unit.ML,
    Dimension.COUNT: Unit.COUNT,
}


def base_unit_for(dimension: Dimension) -> Unit:
    return _BASE_UNIT[dimension]


def to_base(quantity: Decimal, unit: Unit) -> Decimal:
    """A quantity expressed in `unit` -> the same quantity in that unit's
    base unit (g / ml / count). Used at every write boundary so nothing but
    a base value is ever persisted."""
    return quantity * _TO_BASE[unit]


def from_base(base_quantity: Decimal, display_unit: Unit) -> Decimal:
    """The inverse of to_base: a persisted base value -> the exact number
    for a user who's chosen `display_unit`. Not rounded -- use
    display_quantity for anything the API returns."""
    return base_quantity / _TO_BASE[display_unit]


def display_quantity(base_quantity: Decimal, display_unit: Unit) -> Decimal:
    """from_base, rounded to the precision the API has always exposed. The
    single place base->display rounding happens."""
    return from_base(base_quantity, display_unit).quantize(_DISPLAY_QUANTUM, rounding=ROUND_HALF_UP)


def resolve_unit(dimension: Dimension, system: UnitSystem | None) -> Unit:
    if dimension == Dimension.COUNT:
        return Unit.COUNT
    return CANONICAL_UNIT[(dimension, system or UnitSystem.CUSTOMARY)]


def guess_dimension(unit: Unit) -> Dimension:
    """Every Unit has exactly one, fixed dimension -- no longer a "guess"
    now that unit columns are a closed enum instead of free text. Kept
    under its original name to avoid churning every call site that was
    written when this genuinely did guess at unrecognized text (see git
    history before migration 0026_unit_enum)."""
    return _UNIT_DIMENSION[unit]


def guess_system(unit: Unit) -> UnitSystem | None:
    return _UNIT_SYSTEM.get(unit)


def convert(quantity: Decimal, from_unit: Unit, to_unit: Unit) -> Decimal | None:
    """Converts between two units if -- and only if -- they're the same
    dimension. Returns None for a cross-dimension conversion (e.g. grams to
    cups), which needs a food's density; this app deliberately never asks
    users for that, so callers must handle None by treating the two
    quantities as simply not comparable, not by guessing.
    """
    if from_unit == to_unit:
        return quantity
    from_dim = _UNIT_DIMENSION[from_unit]
    to_dim = _UNIT_DIMENSION[to_unit]
    if from_dim != to_dim:
        return None
    if from_dim == Dimension.COUNT:
        return None
    return quantity * _TO_BASE[from_unit] / _TO_BASE[to_unit]
