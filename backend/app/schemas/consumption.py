from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.units import Unit


class ConsumptionEventKind(StrEnum):
    USAGE = "USAGE"
    CORRECTION = "CORRECTION"


class ConsumptionEvent(BaseModel):
    id: UUID
    member_id: UUID
    inventory_item_id: UUID
    # In the item's display unit (converted from the stored base value at
    # the read boundary, same as InventoryItem.quantity). For a CORRECTION
    # this is the signed delta applied to the original entry.
    quantity_used: Decimal
    unit: Unit
    kind: ConsumptionEventKind
    corrects_event_id: UUID | None
    note: str | None
    consumed_at: datetime


class RecordConsumptionCorrectionRequest(BaseModel):
    """Fixes a mis-logged usage entry. `actual_quantity` is what the member
    really used (in `unit`, or the item's own unit if omitted); the service
    works out the signed delta versus what's currently on record for that
    entry (original minus any earlier corrections to it) and appends a
    CORRECTION row for it."""

    corrects_event_id: UUID
    actual_quantity: Decimal = Field(ge=0)
    unit: Unit | None = None
    note: str | None = Field(default=None, max_length=500)
