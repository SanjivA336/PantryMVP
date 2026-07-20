from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class InventoryItemStatus(StrEnum):
    ACTIVE = "ACTIVE"
    EMPTY = "EMPTY"
    DISCARDED = "DISCARDED"
    EXPIRED = "EXPIRED"
    LOST = "LOST"


class RemovalReason(StrEnum):
    """Manual removal reasons — excludes ACTIVE/EMPTY, which are never a
    user-selected "why are you removing this" answer (EMPTY is automatic,
    ACTIVE isn't a removal at all)."""

    DISCARDED = "DISCARDED"
    EXPIRED = "EXPIRED"
    LOST = "LOST"


class InventoryItem(BaseModel):
    id: UUID
    household_id: UUID
    household_food_variant_id: UUID
    storage_location_id: UUID
    purchase_event_id: UUID
    quantity: Decimal
    total_quantity: Decimal
    preferred_unit: str
    cost: Decimal
    purchased_at: datetime
    expiry_date: date | None
    best_by_date: date | None
    freeze_by_date: date | None
    is_frozen: bool
    freeze_date: date | None
    status: InventoryItemStatus
    created_at: datetime
    updated_at: datetime
    # Resolved via joins in the service layer — never stored directly on this
    # table — so the UI can show "Whole Milk" / "Garage Fridge" without a
    # separate round-trip per item.
    food_name: str
    storage_location_name: str


class CreateInventoryItemRequest(BaseModel):
    global_food_definition_id: UUID
    storage_location_id: UUID
    quantity: Decimal = Field(gt=0)
    preferred_unit: str = Field(min_length=1, max_length=20)
    cost: Decimal = Field(default=Decimal(0), ge=0)
    expiry_date: date | None = None
    best_by_date: date | None = None
    allowed_member_ids: list[UUID] = Field(min_length=1)


class ConsumeInventoryItemRequest(BaseModel):
    quantity_used: Decimal = Field(gt=0)
