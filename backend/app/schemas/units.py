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


class MeasurementPreference(BaseModel):
    dimension: Dimension
    # None only for COUNT, which has no metric/customary distinction.
    unit_system: UnitSystem | None
    unit: str
