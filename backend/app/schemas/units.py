from enum import StrEnum

from pydantic import BaseModel


class UnitSystem(StrEnum):
    METRIC = "METRIC"
    CUSTOMARY = "CUSTOMARY"


class Dimension(StrEnum):
    """What *kind* of measurement a food is tracked in. Deliberately not
    convertible into each other -- WEIGHT<->VOLUME needs a food's density,
    which this app never asks users for (see services/units.py)."""

    WEIGHT = "WEIGHT"
    VOLUME = "VOLUME"
    COUNT = "COUNT"


class Unit(StrEnum):
    """Every unit the app can store -- enforced store-side by the `unit`
    Postgres enum (see migration 0026_unit_enum). COUNT deliberately stays
    the one member `count` rather than enumerating package types (bag, box,
    can, dozen, ...): their actual contents vary by product, so a richer
    COUNT vocabulary would only look more precise than it actually is."""

    G = "g"
    KG = "kg"
    OZ = "oz"
    LB = "lb"
    ML = "ml"
    L = "l"
    TSP = "tsp"
    TBSP = "tbsp"
    FL_OZ = "fl_oz"
    CUP = "cup"
    PT = "pt"
    QT = "qt"
    GAL = "gal"
    COUNT = "count"


# A few obvious spellings/synonyms a free-text source (an AI model, older
# data) might use for a unit that isn't itself a valid Unit value.
_UNIT_ALIASES: dict[str, Unit] = {
    "gram": Unit.G,
    "grams": Unit.G,
    "kilogram": Unit.KG,
    "kilograms": Unit.KG,
    "kgs": Unit.KG,
    "ounce": Unit.OZ,
    "ounces": Unit.OZ,
    "pound": Unit.LB,
    "pounds": Unit.LB,
    "lbs": Unit.LB,
    "milliliter": Unit.ML,
    "milliliters": Unit.ML,
    "millilitre": Unit.ML,
    "millilitres": Unit.ML,
    "liter": Unit.L,
    "liters": Unit.L,
    "litre": Unit.L,
    "litres": Unit.L,
    "teaspoon": Unit.TSP,
    "teaspoons": Unit.TSP,
    "tablespoon": Unit.TBSP,
    "tablespoons": Unit.TBSP,
    "fluid ounce": Unit.FL_OZ,
    "fluid ounces": Unit.FL_OZ,
    "fl oz": Unit.FL_OZ,
    "floz": Unit.FL_OZ,
    "cups": Unit.CUP,
    "pint": Unit.PT,
    "pints": Unit.PT,
    "quart": Unit.QT,
    "quarts": Unit.QT,
    "gallon": Unit.GAL,
    "gallons": Unit.GAL,
    "each": Unit.COUNT,
    "ea": Unit.COUNT,
    "piece": Unit.COUNT,
    "pieces": Unit.COUNT,
    "pcs": Unit.COUNT,
    "pc": Unit.COUNT,
    "unit": Unit.COUNT,
    "units": Unit.COUNT,
    "ct": Unit.COUNT,
}


def coerce_unit(raw: str | None) -> Unit | None:
    """Best-effort match of free text against the closed Unit vocabulary --
    returns None (never raises) for anything that isn't a recognized unit
    or a known alias, so callers get a plain "we don't know" instead of a
    guess."""
    if raw is None:
        return None
    key = raw.strip().lower()
    if not key:
        return None
    try:
        return Unit(key)
    except ValueError:
        return _UNIT_ALIASES.get(key)


def coerce_unit_from_ai(value: object) -> Unit | None:
    """Same as coerce_unit, but tolerant of a non-string JSON value too (a
    weak local model occasionally returns something other than a string).
    Used as a Pydantic `mode="before"` validator on AI-produced unit
    fields, so a value outside the closed Unit vocabulary becomes None
    instead of failing the whole response's validation."""
    if value is None:
        return None
    if isinstance(value, Unit):
        return value
    if not isinstance(value, str):
        value = str(value)
    return coerce_unit(value)


class MeasurementPreference(BaseModel):
    dimension: Dimension
    # None only for COUNT, which has no metric/customary distinction.
    unit_system: UnitSystem | None
    unit: Unit
