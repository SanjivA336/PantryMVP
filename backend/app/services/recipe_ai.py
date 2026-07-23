from app.schemas.recipe_ai import (
    DraftRecipe,
    GenerateRecipeParams,
    ImportRecipeRequest,
    SubstitutionSuggestion,
)
from app.services.ai import get_ai_provider
from app.services.recipe_url_import import fetch_recipe_text


def import_recipe(body: ImportRecipeRequest) -> DraftRecipe:
    provider = get_ai_provider()
    if body.source == "url":
        text = fetch_recipe_text(body.url)  # type: ignore[arg-type]
        return provider.parse_recipe(text, source_url=body.url)
    return provider.parse_recipe(body.text)  # type: ignore[arg-type]


def generate_recipe(params: GenerateRecipeParams) -> DraftRecipe:
    return get_ai_provider().generate_recipe(params)


def suggest_substitutions(
    ingredient_name: str, recipe_name: str | None, other_ingredient_names: list[str]
) -> list[SubstitutionSuggestion]:
    return get_ai_provider().suggest_substitutions(
        ingredient_name, recipe_name, other_ingredient_names
    )
