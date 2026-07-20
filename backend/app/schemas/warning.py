from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel


class ExpiryWarningType(StrEnum):
    EXPIRING_SOON = "EXPIRING_SOON"
    EXPIRED = "EXPIRED"


class StockWarningType(StrEnum):
    LOW_STOCK = "LOW_STOCK"
    OUT_OF_STOCK = "OUT_OF_STOCK"


class ExpiryWarning(BaseModel):
    type: ExpiryWarningType
    inventory_item_id: UUID
    food_name: str
    storage_location_name: str
    relevant_date: date
    # Negative once the date has already passed (an EXPIRED item might have
    # sat unflagged for days before anyone opened the app).
    days_until: int


class StockWarning(BaseModel):
    type: StockWarningType
    household_food_variant_id: UUID
    food_name: str
    preferred_unit: str
    remaining_quantity: Decimal
    # The most recent purchase's total_quantity for this food, regardless of
    # that purchase's current status -- the baseline "what a normal buy looks
    # like" that remaining_quantity is judged against.
    reference_quantity: Decimal
    # When that reference purchase happened -- the shopping list's suggest
    # algorithm uses this to tell "dismissed, nothing's changed since" apart
    # from "dismissed, but a new purchase since then means try again".
    reference_purchased_at: datetime


class HouseholdWarnings(BaseModel):
    expiry_warnings: list[ExpiryWarning]
    stock_warnings: list[StockWarning]
