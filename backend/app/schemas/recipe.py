from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.food_definition import FoodCategory
from app.schemas.units import Unit


class RecipeIngredientInput(BaseModel):
    global_food_definition_id: UUID
    quantity: Decimal = Field(gt=0)
    unit: Unit
    note: str | None = None


class CreateRecipeRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    servings: int = Field(gt=0)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    instructions: list[str] = Field(default_factory=list)
    ingredients: list[RecipeIngredientInput] = Field(min_length=1)


class UpdateRecipeRequest(BaseModel):
    """Unlike CreateRecipeRequest, every field here is optional -- a PATCH
    only needs to send what's actually changing (matching every other
    Update*Request in the app). The service layer fills in anything omitted
    from the recipe's current values before calling the update_recipe RPC,
    which itself still expects the full row -- see update_recipe in
    services/recipes.py."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    servings: int | None = Field(default=None, gt=0)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    instructions: list[str] | None = None
    ingredients: list[RecipeIngredientInput] | None = Field(default=None, min_length=1)


class Recipe(BaseModel):
    id: UUID
    created_by_user_id: UUID
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
    category: FoodCategory | None
    quantity: Decimal
    unit: Unit
    note: str | None
    position: int
    # Enrichment computed live against current inventory -- never stored.
    # available_quantity is populated whenever on-hand stock converts into
    # this ingredient's unit (same-dimension, e.g. oz on hand for a recipe
    # asking for grams); a pantry stocked in a different dimension (weight
    # vs. volume) falls back to a plain yes/no via `available` instead,
    # since that needs a food's density, which this app never asks for.
    available: bool
    available_quantity: Decimal | None


class RecipeDetail(Recipe):
    ingredients: list[RecipeIngredient]
