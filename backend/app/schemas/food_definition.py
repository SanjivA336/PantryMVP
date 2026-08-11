from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class AccountingType(StrEnum):
    # The one split rule for anyone but a solo owner -- an equal allotment
    # per person that degrades to usage-based billing for whoever exceeds
    # theirs (see services/accounting.py's compute_item_shares). Replaces
    # the old SHARED_CONSUMABLE/UNIT_BASED distinction; there's no longer a
    # mode to choose between at purchase time.
    SHARED = "SHARED"
    PERSONAL = "PERSONAL"


class FoodCategory(StrEnum):
    PROTEINS = "PROTEINS"
    VEGETABLES_HERBS = "VEGETABLES_HERBS"
    FRUITS = "FRUITS"
    GRAINS_BREADS = "GRAINS_BREADS"
    DAIRY_ALTERNATIVES = "DAIRY_ALTERNATIVES"
    SEASONINGS_SPICES = "SEASONINGS_SPICES"
    OILS_FATS = "OILS_FATS"
    SAUCES_CONDIMENTS = "SAUCES_CONDIMENTS"
    SNACKS_SWEETS = "SNACKS_SWEETS"
    BEVERAGES = "BEVERAGES"
    OTHER = "OTHER"


class FoodDefinition(BaseModel):
    id: UUID
    name: str
    preferred_unit: str
    category: FoodCategory
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
    category: FoodCategory = FoodCategory.OTHER
    accounting_type_default: AccountingType = AccountingType.SHARED
    shelf_life_days: int | None = Field(default=None, gt=0)
    freezer_shelf_life_days: int | None = Field(default=None, gt=0)
    common_substitutions: list[str] = Field(default_factory=list)
