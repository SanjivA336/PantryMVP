from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class RecipeIngredientInput(BaseModel):
    global_food_definition_id: UUID
    quantity: Decimal = Field(gt=0)
    unit: str = Field(min_length=1, max_length=20)
    note: str | None = None


class CreateRecipeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    servings: int = Field(gt=0)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    instructions: list[str] = Field(default_factory=list)
    ingredients: list[RecipeIngredientInput] = Field(min_length=1)


class UpdateRecipeRequest(CreateRecipeRequest):
    pass


class Recipe(BaseModel):
    id: UUID
    household_id: UUID
    created_by_member_id: UUID
    name: str
    description: str | None
    servings: int
    prep_time_minutes: int | None
    cook_time_minutes: int | None
    instructions: list[str]
    created_at: datetime
    updated_at: datetime


class RecipeIngredient(BaseModel):
    id: UUID
    recipe_id: UUID
    global_food_definition_id: UUID
    food_name: str
    quantity: Decimal
    unit: str
    note: str | None
    position: int
    # Enrichment computed live against current inventory -- never stored.
    # available_quantity is populated only when the ingredient's unit
    # exactly matches what's on hand; otherwise it's a plain yes/no via
    # `available` (see the resolved design decision: real unit conversion
    # is out of scope for this phase).
    available: bool
    available_quantity: Decimal | None


class RecipeDetail(Recipe):
    ingredients: list[RecipeIngredient]
