from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class ShoppingListItemSource(StrEnum):
    MANUAL = "MANUAL"
    SUGGESTED = "SUGGESTED"


class ShoppingListItemStatus(StrEnum):
    ACTIVE = "ACTIVE"
    REMOVED = "REMOVED"


class ShoppingListSection(BaseModel):
    id: UUID
    household_id: UUID
    name: str
    created_at: datetime
    updated_at: datetime


class CreateShoppingListSectionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class ShoppingListItem(BaseModel):
    id: UUID
    household_id: UUID
    section_id: UUID | None
    name: str
    household_food_variant_id: UUID | None
    source: ShoppingListItemSource
    status: ShoppingListItemStatus
    added_by_member_id: UUID
    removed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CreateShoppingListItemRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    section_id: UUID | None = None
