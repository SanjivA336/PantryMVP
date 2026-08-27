from typing import Any
from uuid import UUID

from pydantic import ValidationError

from app.schemas.recipe_ai import (
    DraftRecipe,
    GenerateRecipeParams,
    ImportRecipeRequest,
    SubstitutionSuggestion,
)
from app.schemas.units import Unit
from app.services import food_definitions as food_definitions_service
from app.services import inventory_items as inventory_service
from app.services.ai import get_ai_provider
from app.services.recipe_url_import import fetch_recipe_text


class RecipeShareParsingError(Exception):
    pass


def _draft_from_json(data: dict[str, Any]) -> DraftRecipe:
    """Parses a previously-exported recipe JSON file back into a DraftRecipe
    for review -- the human-to-human sharing counterpart to the AI import
    paths below, with no LLM call involved.

    Deliberately never trusts an incoming ingredient's
    global_food_definition_id: it may be from a different Burrow instance's
    catalog, stale, or just hand-edited, and inserting an id that doesn't
    exist in this catalog would fail with a raw FK violation. Every
    ingredient's food is always re-resolved fresh by name against this
    catalog via _resolve_ingredient_food_ids below, exactly like an
    AI-parsed draft.
    """
    ingredients = data.get("ingredients")
    if isinstance(ingredients, list):
        for ingredient in ingredients:
            if isinstance(ingredient, dict):
                ingredient.pop("global_food_definition_id", None)
    try:
        return DraftRecipe.model_validate({**data, "source_url": None})
    except ValidationError as exc:
        raise RecipeShareParsingError("That file doesn't look like a valid recipe export.") from exc


def _resolve_ingredient_food_ids(household_id: UUID, draft: DraftRecipe) -> None:
    """Thin wrapper around food_definitions.resolve_food_ids (the matching
    strategy lives there, shared with receipt_imports.py) -- fills in each
    ingredient's global_food_definition_id wherever confident, leaves it
    null (today's manual-pick-via-FoodSearchInput behavior) otherwise.
    """
    resolved = food_definitions_service.resolve_food_ids(
        household_id, [ing.name for ing in draft.ingredients]
    )
    for ingredient in draft.ingredients:
        if ingredient.name in resolved:
            ingredient.global_food_definition_id = resolved[ingredient.name]


def import_recipe(household_id: UUID, body: ImportRecipeRequest) -> DraftRecipe:
    if body.source == "json":
        draft = _draft_from_json(body.json_data)  # type: ignore[arg-type]
    else:
        provider = get_ai_provider()
        if body.source == "url":
            text = fetch_recipe_text(body.url)  # type: ignore[arg-type]
            draft = provider.parse_recipe(text, source_url=body.url)
        else:
            draft = provider.parse_recipe(body.text)  # type: ignore[arg-type]
    _resolve_ingredient_food_ids(household_id, draft)
    return draft


def generate_recipe(household_id: UUID, params: GenerateRecipeParams) -> DraftRecipe:
    if params.pantry_only:
        active_items = inventory_service.list_for_household(household_id, status="ACTIVE")
        params.available_ingredients = sorted({item.food_name for item in active_items})
    draft = get_ai_provider().generate_recipe(params)
    _resolve_ingredient_food_ids(household_id, draft)
    return draft


def suggest_substitutions(
    ingredient_name: str,
    ingredient_quantity: str | None,
    ingredient_unit: Unit | None,
    recipe_name: str | None,
    other_ingredient_names: list[str],
) -> list[SubstitutionSuggestion]:
    return get_ai_provider().suggest_substitutions(
        ingredient_name,
        ingredient_quantity,
        ingredient_unit,
        recipe_name,
        other_ingredient_names,
    )
