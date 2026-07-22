from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.food_definition import AccountingType


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
    storage_location_id: UUID | None
    storage_location_name: str | None
    quantity: Decimal | None
    preferred_unit: str | None
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


class UpdateReceiptImportItemRequest(BaseModel):
    global_food_definition_id: UUID | None = None
    storage_location_id: UUID | None = None
    quantity: Decimal | None = Field(default=None, gt=0)
    preferred_unit: str | None = None
    cost: Decimal | None = Field(default=None, ge=0)
    accounting_type: AccountingType | None = None
    allowed_member_ids: list[UUID] | None = None
    status: ReceiptImportItemStatus | None = None
