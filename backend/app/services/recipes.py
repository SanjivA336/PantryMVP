from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.recipe import CreateRecipeRequest, Recipe, RecipeDetail, RecipeIngredient

_RECIPES_TABLE = "recipes"
_INGREDIENTS_TABLE = "recipe_ingredients"


class RecipeNotFoundError(Exception):
    pass


def list_recipes(household_id: UUID) -> list[Recipe]:
    client = get_service_client()
    result = (
        client.table(_RECIPES_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .order("created_at", desc=True)
        .execute()
    )
    return [Recipe(**row) for row in result.data]


def _ingredient_availability(
    household_id: UUID, ingredient_rows: list[dict]
) -> dict[UUID, tuple[bool, Decimal | None]]:
    """Maps recipe_ingredients.id -> (available, available_quantity).

    available_quantity is only set when the ingredient's unit exactly
    matches the inventory's preferred_unit for that food -- otherwise the
    ingredient is still marked available/unavailable (binary), just without
    a quantity to show, per the resolved no-unit-conversion decision.
    """
    food_ids = {row["global_food_definition_id"] for row in ingredient_rows}
    if not food_ids:
        return {}

    client = get_service_client()
    variants = (
        client.table("household_food_variants")
        .select("id, global_food_definition_id")
        .eq("household_id", str(household_id))
        .in_("global_food_definition_id", list(food_ids))
        .execute()
    )
    variant_id_by_food_id = {row["global_food_definition_id"]: row["id"] for row in variants.data}
    variant_ids = list(variant_id_by_food_id.values())

    on_hand: dict[str, tuple[Decimal, str]] = {}
    if variant_ids:
        items = (
            client.table("inventory_items")
            .select("household_food_variant_id, quantity, preferred_unit")
            .eq("household_id", str(household_id))
            .eq("status", "ACTIVE")
            .in_("household_food_variant_id", variant_ids)
            .execute()
        )
        for row in items.data:
            variant_id = row["household_food_variant_id"]
            qty = Decimal(str(row["quantity"]))
            total, _ = on_hand.get(variant_id, (Decimal(0), row["preferred_unit"]))
            on_hand[variant_id] = (total + qty, row["preferred_unit"])

    result: dict[UUID, tuple[bool, Decimal | None]] = {}
    for row in ingredient_rows:
        variant_id = variant_id_by_food_id.get(row["global_food_definition_id"])
        stock = on_hand.get(variant_id) if variant_id else None
        if stock is None or stock[0] <= 0:
            result[UUID(row["id"])] = (False, None)
            continue
        on_hand_qty, on_hand_unit = stock
        matches_unit = on_hand_unit == row["unit"]
        result[UUID(row["id"])] = (True, on_hand_qty if matches_unit else None)

    return result


def get_recipe(household_id: UUID, recipe_id: UUID) -> RecipeDetail | None:
    client = get_service_client()
    recipe_result = (
        client.table(_RECIPES_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .eq("id", str(recipe_id))
        .maybe_single()
        .execute()
    )
    if not recipe_result or not recipe_result.data:
        return None

    ingredients_result = (
        client.table(_INGREDIENTS_TABLE)
        .select("*, global_food_definitions(name)")
        .eq("recipe_id", str(recipe_id))
        .order("position")
        .execute()
    )
    availability = _ingredient_availability(household_id, ingredients_result.data)

    ingredients: list[RecipeIngredient] = []
    for row in ingredients_result.data:
        food = row.pop("global_food_definitions", None) or {}
        available, available_quantity = availability.get(UUID(row["id"]), (False, None))
        ingredients.append(
            RecipeIngredient(
                **row,
                food_name=food.get("name", "Unknown food"),
                available=available,
                available_quantity=available_quantity,
            )
        )

    return RecipeDetail(**recipe_result.data, ingredients=ingredients)


def create_recipe(household_id: UUID, member_id: UUID, body: CreateRecipeRequest) -> RecipeDetail:
    client = get_service_client()
    rpc_result = client.rpc(
        "create_recipe",
        {
            "p_household_id": str(household_id),
            "p_member_id": str(member_id),
            "p_name": body.name,
            "p_description": body.description,
            "p_servings": body.servings,
            "p_prep_time_minutes": body.prep_time_minutes,
            "p_cook_time_minutes": body.cook_time_minutes,
            "p_instructions": body.instructions,
            "p_ingredients": [
                {
                    "global_food_definition_id": str(ing.global_food_definition_id),
                    "quantity": str(ing.quantity),
                    "unit": ing.unit,
                    "note": ing.note,
                }
                for ing in body.ingredients
            ],
        },
    ).execute()
    new_id = (
        rpc_result.data[0]["id"] if isinstance(rpc_result.data, list) else rpc_result.data["id"]
    )
    return get_recipe(household_id, UUID(new_id))  # type: ignore[return-value]


def update_recipe(household_id: UUID, recipe_id: UUID, body: CreateRecipeRequest) -> RecipeDetail:
    client = get_service_client()
    try:
        client.rpc(
            "update_recipe",
            {
                "p_household_id": str(household_id),
                "p_recipe_id": str(recipe_id),
                "p_name": body.name,
                "p_description": body.description,
                "p_servings": body.servings,
                "p_prep_time_minutes": body.prep_time_minutes,
                "p_cook_time_minutes": body.cook_time_minutes,
                "p_instructions": body.instructions,
                "p_ingredients": [
                    {
                        "global_food_definition_id": str(ing.global_food_definition_id),
                        "quantity": str(ing.quantity),
                        "unit": ing.unit,
                        "note": ing.note,
                    }
                    for ing in body.ingredients
                ],
            },
        ).execute()
    except APIError as exc:
        if "RECIPE_NOT_FOUND" in str(exc):
            raise RecipeNotFoundError from exc
        raise
    return get_recipe(household_id, recipe_id)  # type: ignore[return-value]


def delete_recipe(household_id: UUID, recipe_id: UUID) -> None:
    client = get_service_client()
    client.table(_RECIPES_TABLE).delete().eq("household_id", str(household_id)).eq(
        "id", str(recipe_id)
    ).execute()
