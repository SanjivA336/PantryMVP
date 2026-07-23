from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class DraftRecipeIngredient(BaseModel):
    """Plain text, never a resolved food id -- the human always picks the
    real catalog food via FoodSearchInput, same as receipt-import lines
    never auto-resolve a food id either."""

    name: str = Field(min_length=1)
    quantity: str | None = None
    unit: str | None = None
    note: str | None = None

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
    cuisine: str | None = None
    max_total_time_minutes: int | None = Field(default=None, gt=0)
    dietary_restrictions: list[str] = Field(default_factory=list)
    required_ingredients: list[str] = Field(default_factory=list)
    servings: int | None = Field(default=None, gt=0)


class SubstitutionRequest(BaseModel):
    ingredient_name: str = Field(min_length=1)
    recipe_name: str | None = None
    other_ingredient_names: list[str] = Field(default_factory=list)


class SubstitutionSuggestion(BaseModel):
    name: str
    note: str | None = None
