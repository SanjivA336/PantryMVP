from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator


class DraftRecipeIngredient(BaseModel):
    """`name` is always the AI's raw text -- `global_food_definition_id` is
    filled in afterward (see recipe_ai.py's resolve step) when an exact or
    close name match exists, preferring foods already in the household's
    inventory. Left null when no confident match was found, same as
    receipt-import lines never auto-resolve a food id either -- the human
    picks via FoodSearchInput in that case."""

    name: str = Field(min_length=1)
    quantity: str | None = None
    unit: str | None = None
    note: str | None = None
    global_food_definition_id: UUID | None = None

    @field_validator("quantity", "unit", "note", mode="before")
    @classmethod
    def _coerce_to_string(cls, value: object) -> object:
        # A weak local model occasionally returns a bare JSON number (e.g.
        # quantity: 2) instead of the requested string. Pydantic's default
        # lax mode coerces str->int but not the reverse, so without this a
        # perfectly reasonable "2" would fail validation and take down the
        # whole draft over one stray type.
        if value is None or isinstance(value, str):
            return value
        return str(value)


class DraftRecipe(BaseModel):
    """Never persisted directly -- the frontend holds this in memory and
    submits it through the existing POST /recipes create flow once the
    user has reviewed it (picked real foods, fixed anything wrong)."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    servings: int | None = Field(default=None, gt=0)
    prep_time_minutes: int | None = Field(default=None, ge=0)
    cook_time_minutes: int | None = Field(default=None, ge=0)
    instructions: list[str] = Field(min_length=1)
    ingredients: list[DraftRecipeIngredient] = Field(min_length=1)
    source_url: str | None = None

    @field_validator("instructions", mode="before")
    @classmethod
    def _coerce_instruction_steps(cls, value: object) -> object:
        # A weak local model sometimes wraps each step in an object (e.g.
        # {"step": "..."}) instead of returning a plain string, confirmed by
        # direct testing -- take the first string value found rather than
        # failing the whole draft over a shape mismatch that carries no real
        # ambiguity about what the model meant.
        if not isinstance(value, list):
            return value
        coerced = []
        for item in value:
            if isinstance(item, str):
                coerced.append(item)
            elif isinstance(item, dict):
                text = next((v for v in item.values() if isinstance(v, str)), None)
                coerced.append(text if text is not None else str(item))
            else:
                coerced.append(str(item))
        return coerced


class ImportRecipeRequest(BaseModel):
    source: Literal["text", "url"]
    text: str | None = None
    url: str | None = None

    @model_validator(mode="after")
    def _require_matching_field(self) -> "ImportRecipeRequest":
        if self.source == "text" and not (self.text and self.text.strip()):
            raise ValueError("text is required when source is 'text'")
        if self.source == "url" and not (self.url and self.url.strip()):
            raise ValueError("url is required when source is 'url'")
        return self


class GenerateRecipeParams(BaseModel):
    # A multi-select of cuisine options -- the AI picks one, rather than the
    # user committing to a single cuisine up front.
    cuisines: list[str] = Field(default_factory=list)
    # A range, not just an upper bound -- "5-10 min" and "under 45 min" read
    # very differently to a recipe-writer even though both cap at some
    # number. max with no min left open-ended (the "1hr+" preset).
    min_total_time_minutes: int | None = Field(default=None, gt=0)
    max_total_time_minutes: int | None = Field(default=None, gt=0)
    dietary_restrictions: list[str] = Field(default_factory=list)
    # Free-text names, not ids -- the user picks these from their current
    # inventory client-side, but the AI only needs the name to work with.
    required_ingredients: list[str] = Field(default_factory=list)
    # A short freeform ask ("something with leftover rice", "kid-friendly"),
    # folded into the prompt as one more constraint line.
    description: str | None = Field(default=None, max_length=500)
    # When set, the service layer resolves the household's current ACTIVE
    # inventory into available_ingredients below before calling the AI
    # provider -- the client only needs to flip this flag, not enumerate
    # its own inventory (which the server already knows and the client
    # could otherwise send stale or spoofed).
    pantry_only: bool = False
    # Populated server-side only (see generate_recipe in services/recipe_ai.py)
    # -- any value sent by the client here is ignored and overwritten.
    available_ingredients: list[str] = Field(default_factory=list)


class SubstitutionRequest(BaseModel):
    ingredient_name: str = Field(min_length=1)
    ingredient_quantity: str | None = None
    ingredient_unit: str | None = None
    recipe_name: str | None = None
    other_ingredient_names: list[str] = Field(default_factory=list)


class SubstitutionSuggestion(BaseModel):
    name: str
    # How much of the substitute is needed to match the original ingredient's
    # contribution -- not always the same amount, and not always even the
    # same unit (e.g. bananas by count, oatmeal by weight), so this can't be
    # assumed equal to the original ingredient's own quantity/unit.
    quantity: str | None = None
    unit: str | None = None
    note: str | None = None

    @field_validator("quantity", mode="before")
    @classmethod
    def _coerce_quantity_to_string(cls, value: object) -> object:
        if value is None or isinstance(value, str):
            return value
        return str(value)
