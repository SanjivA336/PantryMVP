from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.food_definition import AccountingType, FoodCategory
from app.schemas.units import Unit


class PurchaseSessionSource(StrEnum):
    RECEIPT_SCAN = "RECEIPT_SCAN"
    SHOPPING_LIST = "SHOPPING_LIST"


class PurchaseSessionStatus(StrEnum):
    # RECEIPT_SCAN moves PENDING -> PROCESSING -> COMPLETED -> FINALIZED (or
    # -> FAILED). SHOPPING_LIST stays PENDING (its "draft" state) until
    # FINALIZED -- there's nothing to process.
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    FINALIZED = "FINALIZED"


class PurchaseSessionItemStatus(StrEnum):
    PENDING = "PENDING"
    COMPLETE = "COMPLETE"
    IMPORTED = "IMPORTED"


class PurchaseSession(BaseModel):
    id: UUID
    household_id: UUID
    created_by_member_id: UUID
    source: PurchaseSessionSource
    status: PurchaseSessionStatus
    # RECEIPT_SCAN only -- the Storage object path for the receipt photo.
    image_path: str | None
    ocr_engine: str | None
    raw_ocr_text: str | None
    error_message: str | None
    processed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class PurchaseSessionItem(BaseModel):
    id: UUID
    session_id: UUID
    position: int
    raw_line_text: str
    parsed_name: str | None
    parsed_quantity: Decimal | None
    parsed_unit: str | None
    parsed_price: Decimal | None
    global_food_definition_id: UUID | None
    food_name: str | None
    category: FoodCategory | None
    storage_location_id: UUID | None
    storage_location_name: str | None
    quantity: Decimal | None
    preferred_unit: Unit | None
    cost: Decimal | None
    accounting_type: AccountingType | None
    allowed_member_ids: list[UUID]
    # Per-line buyer (the wizard's sticky-buyer flow). Null -> finalize
    # falls back to the session's creator.
    buyer_member_id: UUID | None
    # The shopping-list item this line came from, if any (a wizard line can
    # also be added ad hoc). Kept for the "delete draft order" path.
    shopping_list_item_id: UUID | None
    status: PurchaseSessionItemStatus
    created_inventory_item_id: UUID | None
    created_at: datetime
    updated_at: datetime


class PurchaseSessionWithItems(PurchaseSession):
    items: list[PurchaseSessionItem]


class CreateReceiptSessionRequest(BaseModel):
    filename: str | None = None


class CreateReceiptSessionResponse(BaseModel):
    id: UUID
    upload_bucket: str
    upload_path: str


class ParsedReceiptItem(BaseModel):
    """One AI-extracted candidate line item from raw OCR receipt text (see
    OllamaProvider.parse_receipt_items). `name` and `price` are the two
    fields the extraction is expected to always get right off a real
    receipt; `quantity`/`unit` are best-effort and often legitimately
    absent. Kept as plain strings (not Decimal) so one malformed value
    can't fail Pydantic validation for the whole batch -- purchase_sessions
    coerces them itself and drops only the individual item that doesn't
    parse, rather than losing every item in the response.
    """

    name: str = Field(min_length=1)
    price: str
    quantity: str | None = None
    unit: str | None = None

    @field_validator("price", "quantity", "unit", mode="before")
    @classmethod
    def _coerce_to_string(cls, value: object) -> object:
        if value is None or isinstance(value, str):
            return value
        return str(value)


class UpdatePurchaseSessionItemRequest(BaseModel):
    global_food_definition_id: UUID | None = None
    storage_location_id: UUID | None = None
    quantity: Decimal | None = Field(default=None, gt=0)
    preferred_unit: Unit | None = None
    cost: Decimal | None = Field(default=None, ge=0)
    accounting_type: AccountingType | None = None
    allowed_member_ids: list[UUID] | None = None
    buyer_member_id: UUID | None = None
    status: PurchaseSessionItemStatus | None = None
