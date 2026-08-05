from decimal import Decimal

from app.schemas.units import Dimension, UnitSystem

# Base unit per dimension: grams for weight, milliliters for volume, plain
# count for count. Every recognized unit's factor converts 1 of that unit
# into this base -- e.g. 1 oz = 28.3495 base units (grams).
#
# This intentionally recognizes more units than the Add Item picker offers
# (kg, lb, tbsp, tsp, fl_oz) -- existing data written before this feature
# existed, or a food's own catalog default, may already use them, and they
# should still convert/sum correctly even though new entries only ever pick
# from CANONICAL_UNIT below.
_TO_BASE: dict[str, Decimal] = {
    "g": Decimal("1"),
    "kg": Decimal("1000"),
    "oz": Decimal("28.3495"),
    "lb": Decimal("453.592"),
    "ml": Decimal("1"),
    "l": Decimal("1000"),
    "cup": Decimal("236.588"),
    "tbsp": Decimal("14.7868"),
    "tsp": Decimal("4.92892"),
    "fl_oz": Decimal("29.5735"),
    "count": Decimal("1"),
}

_UNIT_DIMENSION: dict[str, Dimension] = {
    "g": Dimension.WEIGHT,
    "kg": Dimension.WEIGHT,
    "oz": Dimension.WEIGHT,
    "lb": Dimension.WEIGHT,
    "ml": Dimension.VOLUME,
    "l": Dimension.VOLUME,
    "cup": Dimension.VOLUME,
    "tbsp": Dimension.VOLUME,
    "tsp": Dimension.VOLUME,
    "fl_oz": Dimension.VOLUME,
    "count": Dimension.COUNT,
}

_UNIT_SYSTEM: dict[str, UnitSystem] = {
    "g": UnitSystem.METRIC,
    "kg": UnitSystem.METRIC,
    "ml": UnitSystem.METRIC,
    "l": UnitSystem.METRIC,
    "oz": UnitSystem.CUSTOMARY,
    "lb": UnitSystem.CUSTOMARY,
    "cup": UnitSystem.CUSTOMARY,
    "tbsp": UnitSystem.CUSTOMARY,
    "tsp": UnitSystem.CUSTOMARY,
    "fl_oz": UnitSystem.CUSTOMARY,
}

# The one unit the app itself writes for each (dimension, system) pair. Only
# these five ever come out of the Add Item picker; the wider recognized set
# above exists purely to keep older/foreign data comparable.
CANONICAL_UNIT: dict[tuple[Dimension, UnitSystem], str] = {
    (Dimension.WEIGHT, UnitSystem.METRIC): "g",
    (Dimension.WEIGHT, UnitSystem.CUSTOMARY): "oz",
    (Dimension.VOLUME, UnitSystem.METRIC): "ml",
    (Dimension.VOLUME, UnitSystem.CUSTOMARY): "cup",
}


def resolve_unit(dimension: Dimension, system: UnitSystem | None) -> str:
    if dimension == Dimension.COUNT:
        return "count"
    return CANONICAL_UNIT[(dimension, system or UnitSystem.CUSTOMARY)]


def guess_dimension(unit: str) -> Dimension:
    """Best-effort guess for a unit the app didn't just write itself (a
    food's own catalog default, or historical data) -- anything
    unrecognized defaults to COUNT, the safest bucket, since it never gets
    silently summed against a real weight/volume total."""
    return _UNIT_DIMENSION.get(unit.strip().lower(), Dimension.COUNT)


def guess_system(unit: str) -> UnitSystem | None:
    return _UNIT_SYSTEM.get(unit.strip().lower())


def convert(quantity: Decimal, from_unit: str, to_unit: str) -> Decimal | None:
    """Converts between two units if -- and only if -- they're the same
    dimension. Returns None for a cross-dimension conversion (e.g. grams to
    cups), which needs a food's density; this app deliberately never asks
    users for that, so callers must handle None by treating the two
    quantities as simply not comparable, not by guessing.
    """
    from_key = from_unit.strip().lower()
    to_key = to_unit.strip().lower()
    if from_key == to_key:
        return quantity
    from_dim = _UNIT_DIMENSION.get(from_key)
    to_dim = _UNIT_DIMENSION.get(to_key)
    if from_dim is None or to_dim is None or from_dim != to_dim:
        return None
    if from_dim == Dimension.COUNT:
        return None
    return quantity * _TO_BASE[from_key] / _TO_BASE[to_key]
