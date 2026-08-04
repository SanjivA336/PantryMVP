from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.food_definition import AccountingType, FoodCategory


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
    accounting_type: AccountingType
    split_member_count: int | None
    created_at: datetime
    updated_at: datetime
    # A label on this specific physical item (e.g. "HEB milk" vs "Costco
    # milk" for two jugs that are both Whole Milk underneath) — distinct
    # from food_name below, which is what actually displays (this item's
    # own override if set, else the food's name).
    name_override: str | None
    # Resolved via joins in the service layer — never stored directly on this
    # table — so the UI can show "Whole Milk" / "Garage Fridge" without a
    # separate round-trip per item.
    food_name: str
    # The underlying food definition's own name, always -- unlike food_name,
    # this doesn't get replaced by name_override. Lets search match "Whole
    # Milk" even on an item nicknamed "Costco milk", alongside name_override.
    food_type_name: str
    # Optional, unlike FoodDefinition.category itself: the variant's
    # global_food_definition_id can be null'd out (food deleted upstream),
    # in which case the enrichment join comes back empty.
    category: FoodCategory | None
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
    # Optional: falls back to the chosen food definition's accounting_type_default
    # when omitted (resolved in the service layer, not the RPC — this is a
    # product-level fallback decision, not a database invariant).
    accounting_type: AccountingType | None = None
    # A per-item label (see InventoryItem.name_override) -- not the food's
    # name, just how this household tells its own jugs/cartons apart.
    name_override: str | None = Field(default=None, max_length=200)
    # Who actually bought this -- defaults to the caller when omitted, but
    # any active member can be picked (e.g. entering a purchase your
    # roommate made). Becomes purchase_events.member_id, same as it always
    # has been; this just lets the caller name someone other than themselves.
    buyer_member_id: UUID | None = None


class ConsumeInventoryItemRequest(BaseModel):
    quantity_used: Decimal = Field(gt=0)
