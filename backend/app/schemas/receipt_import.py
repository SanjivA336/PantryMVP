from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.schemas.food_definition import AccountingType, FoodCategory
from app.schemas.units import Unit


class ReceiptImportSessionStatus(StrEnum):
    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    FINALIZED = "FINALIZED"


class ReceiptImportItemStatus(StrEnum):
    NEEDS_REVIEW = "NEEDS_REVIEW"
    CONFIRMED = "CONFIRMED"
    SKIPPED = "SKIPPED"
    IMPORTED = "IMPORTED"


class ReceiptImportSession(BaseModel):
    id: UUID
    household_id: UUID
    created_by_member_id: UUID
    status: ReceiptImportSessionStatus
    image_path: str
    ocr_engine: str | None
    raw_ocr_text: str | None
    error_message: str | None
    processed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ReceiptImportItem(BaseModel):
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
    status: ReceiptImportItemStatus
    created_inventory_item_id: UUID | None
    created_at: datetime
    updated_at: datetime


class ReceiptImportSessionWithItems(ReceiptImportSession):
    items: list[ReceiptImportItem]


class CreateReceiptImportSessionRequest(BaseModel):
    filename: str | None = None


class CreateReceiptImportSessionResponse(BaseModel):
    id: UUID
    upload_bucket: str
    upload_path: str


class ParsedReceiptItem(BaseModel):
    """One AI-extracted candidate line item from raw OCR receipt text (see
    OllamaProvider.parse_receipt_items). `name` and `price` are the two
    fields the extraction is expected to always get right off a real
    receipt; `quantity`/`unit` are best-effort and often legitimately
    absent. Kept as plain strings (not Decimal) so one malformed value
    can't fail Pydantic validation for the whole batch -- receipt_imports.py
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
        # A weak local model occasionally returns a bare JSON number (e.g.
        # price: 4.99) instead of the requested string -- Pydantic's lax
        # mode coerces str->number but not the reverse.
        if value is None or isinstance(value, str):
            return value
        return str(value)


class UpdateReceiptImportItemRequest(BaseModel):
    global_food_definition_id: UUID | None = None
    storage_location_id: UUID | None = None
    quantity: Decimal | None = Field(default=None, gt=0)
    preferred_unit: Unit | None = None
    cost: Decimal | None = Field(default=None, ge=0)
    accounting_type: AccountingType | None = None
    allowed_member_ids: list[UUID] | None = None
    status: ReceiptImportItemStatus | None = None
