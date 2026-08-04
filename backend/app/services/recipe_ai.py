from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.recipe_ai import (
    DraftRecipe,
    GenerateRecipeParams,
    ImportRecipeRequest,
    SubstitutionSuggestion,
)
from app.services import food_definitions as food_definitions_service
from app.services import inventory_items as inventory_service
from app.services.ai import get_ai_provider
from app.services.recipe_url_import import fetch_recipe_text


def _resolve_ingredient_food_ids(household_id: UUID, draft: DraftRecipe) -> None:
    """Best-effort exact-name match against the household's current
    inventory first, then the wider global catalog -- fills in
    global_food_definition_id wherever confident, leaves it null (today's
    manual-pick-via-FoodSearchInput behavior) otherwise. Deliberately only a
    case-insensitive exact match counts as confident enough to auto-link --
    fuzzy/semantic matching is out of scope for this pass.
    """
    client = get_service_client()
    inventory_result = (
        client.table("household_food_variants")
        .select("global_food_definitions(id, name)")
        .eq("household_id", str(household_id))
        .execute()
    )
    inventory_by_name: dict[str, UUID] = {}
    for row in inventory_result.data:
        food = row.get("global_food_definitions")
        if food and food.get("name"):
            inventory_by_name[food["name"].strip().lower()] = UUID(food["id"])

    unmatched = []
    for ingredient in draft.ingredients:
        key = ingredient.name.strip().lower()
        if key in inventory_by_name:
            ingredient.global_food_definition_id = inventory_by_name[key]
        else:
            unmatched.append(ingredient)
    if not unmatched:
        return

    # Each remaining ingredient needs its own distinct text search, so this
    # can't collapse into one query -- but the searches are independent of
    # each other, so running them concurrently turns N sequential round
    # trips into roughly one round trip's worth of wall-clock time.
    with ThreadPoolExecutor(max_workers=min(len(unmatched), 8)) as pool:
        results = pool.map(
            lambda ing: food_definitions_service.search(ing.name, limit=5), unmatched
        )

    for ingredient, candidates in zip(unmatched, results, strict=True):
        key = ingredient.name.strip().lower()
        exact = next((c for c in candidates if c.name.strip().lower() == key), None)
        if exact:
            ingredient.global_food_definition_id = exact.id


def import_recipe(household_id: UUID, body: ImportRecipeRequest) -> DraftRecipe:
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
    ingredient_unit: str | None,
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
