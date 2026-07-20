from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class AccountingType(StrEnum):
    UNIT_BASED = "UNIT_BASED"
    SHARED_CONSUMABLE = "SHARED_CONSUMABLE"
    PERSONAL = "PERSONAL"


class FoodDefinition(BaseModel):
    id: UUID
    name: str
    preferred_unit: str
    food_group: str | None
    accounting_type_default: AccountingType
    shelf_life_days: int | None
    freezer_shelf_life_days: int | None
    common_substitutions: list[str]
    created_by_user_id: UUID | None
    is_verified: bool
    usage_count: int
    duplicate_of_id: UUID | None
    created_at: datetime
    updated_at: datetime


class CreateFoodDefinitionRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    preferred_unit: str = Field(min_length=1, max_length=20)
    food_group: str | None = None
    accounting_type_default: AccountingType = AccountingType.SHARED_CONSUMABLE
    shelf_life_days: int | None = Field(default=None, gt=0)
    freezer_shelf_life_days: int | None = Field(default=None, gt=0)
    common_substitutions: list[str] = Field(default_factory=list)
