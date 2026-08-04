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
    sort_order: int
    created_at: datetime
    updated_at: datetime


class CreateShoppingListSectionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class UpdateShoppingListSectionRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    sort_order: int | None = None


class ShoppingListItem(BaseModel):
    id: UUID
    household_id: UUID
    section_id: UUID | None
    name: str
    household_food_variant_id: UUID | None
    source: ShoppingListItemSource
    status: ShoppingListItemStatus
    collected: bool
    sort_order: int
    added_by_member_id: UUID
    removed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CreateShoppingListItemRequest(BaseModel):
    # Manual items now always resolve to a real (or newly-created) food, the
    # same way Add Item's food picker works -- keeps them matchable by the
    # suggest algorithm's household_food_variant_id lookup instead of being
    # unlinked free text forever.
    global_food_definition_id: UUID
    section_id: UUID | None = None


class UpdateShoppingListItemRequest(BaseModel):
    collected: bool | None = None
    section_id: UUID | None = None
    sort_order: int | None = None


class IgnoreShoppingListVariantRequest(BaseModel):
    household_food_variant_id: UUID
