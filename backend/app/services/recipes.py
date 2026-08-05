from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.recipe import (
    CreateRecipeRequest,
    Recipe,
    RecipeDetail,
    RecipeIngredient,
    RecipeIngredientInput,
    UpdateRecipeRequest,
)
from app.services import units as units_service

_RECIPES_TABLE = "recipes"
_INGREDIENTS_TABLE = "recipe_ingredients"


class RecipeNotFoundError(Exception):
    pass


def list_recipes(user_id: UUID) -> list[Recipe]:
    client = get_service_client()
    result = (
        client.table(_RECIPES_TABLE)
        .select("*")
        .eq("created_by_user_id", str(user_id))
        .order("created_at", desc=True)
        .execute()
    )
    return [Recipe(**row) for row in result.data]


def _ingredient_availability(
    household_id: UUID, ingredient_rows: list[dict]
) -> dict[UUID, tuple[bool, Decimal | None]]:
    """Maps recipe_ingredients.id -> (available, available_quantity), checked
    against household_id's current pantry -- recipes are owned by a user, not
    a household, but availability is always relative to whichever kitchen
    you're currently viewing the recipe from (the same recipe can show
    different availability in different households you belong to).

    available_quantity converts on-hand stock into the recipe's requested
    unit (e.g. the pantry has it in grams, the recipe asks for ounces) via
    units.convert -- exact-unit and same-dimension matches both resolve to a
    real number now. A pantry stocked in a different *dimension* than the
    recipe asks for (weight on hand, recipe wants volume, or vice versa)
    can't be compared without a density this app never asks for, so that
    case falls back to binary available/unavailable with no quantity shown,
    per the resolved no-density decision.
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

    on_hand: dict[str, list[tuple[Decimal, str]]] = {}
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
            on_hand.setdefault(variant_id, []).append((qty, row["preferred_unit"]))

    result: dict[UUID, tuple[bool, Decimal | None]] = {}
    for row in ingredient_rows:
        variant_id = variant_id_by_food_id.get(row["global_food_definition_id"])
        stock = on_hand.get(variant_id) if variant_id else None
        if not stock:
            result[UUID(row["id"])] = (False, None)
            continue

        requested_unit = row["unit"]
        convertible_total = Decimal(0)
        any_convertible = False
        for qty, unit in stock:
            converted = units_service.convert(qty, unit, requested_unit)
            if converted is not None:
                convertible_total += converted
                any_convertible = True

        if any_convertible:
            available = convertible_total > 0
            result[UUID(row["id"])] = (available, convertible_total if available else None)
        else:
            total_any_unit = sum((qty for qty, _ in stock), Decimal(0))
            result[UUID(row["id"])] = (total_any_unit > 0, None)

    return result


def _fetch_recipe_and_ingredients(
    user_id: UUID, recipe_id: UUID
) -> tuple[dict, list[dict]] | None:
    """The two raw-row queries get_recipe builds on. Split out so
    update_recipe's pre-update defaulting fetch (which only reads these
    stored fields) can skip get_recipe's extra availability computation --
    2 queries instead of 4 for every PATCH.

    Scoped to user_id, not any household -- a recipe is only ever visible to
    (and editable by) the user who created it.
    """
    client = get_service_client()
    recipe_result = (
        client.table(_RECIPES_TABLE)
        .select("*")
        .eq("created_by_user_id", str(user_id))
        .eq("id", str(recipe_id))
        .maybe_single()
        .execute()
    )
    if not recipe_result or not recipe_result.data:
        return None

    ingredients_result = (
        client.table(_INGREDIENTS_TABLE)
        .select("*, global_food_definitions(name, category)")
        .eq("recipe_id", str(recipe_id))
        .order("position")
        .execute()
    )
    return recipe_result.data, ingredients_result.data


def get_recipe(household_id: UUID, user_id: UUID, recipe_id: UUID) -> RecipeDetail | None:
    fetched = _fetch_recipe_and_ingredients(user_id, recipe_id)
    if fetched is None:
        return None
    recipe_row, ingredient_rows = fetched
    availability = _ingredient_availability(household_id, ingredient_rows)

    ingredients: list[RecipeIngredient] = []
    for row in ingredient_rows:
        food = row.pop("global_food_definitions", None) or {}
        available, available_quantity = availability.get(UUID(row["id"]), (False, None))
        ingredients.append(
            RecipeIngredient(
                **row,
                food_name=food.get("name", "Unknown food"),
                category=food.get("category"),
                available=available,
                available_quantity=available_quantity,
            )
        )

    return RecipeDetail(**recipe_row, ingredients=ingredients)


def create_recipe(
    household_id: UUID, user_id: UUID, body: CreateRecipeRequest
) -> RecipeDetail:
    client = get_service_client()
    rpc_result = client.rpc(
        "create_recipe",
        {
            "p_user_id": str(user_id),
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
    return get_recipe(household_id, user_id, UUID(new_id))  # type: ignore[return-value]


def update_recipe(
    household_id: UUID, user_id: UUID, recipe_id: UUID, body: UpdateRecipeRequest
) -> RecipeDetail:
    """A genuine partial update: update_recipe (the RPC) still expects every
    field, since it atomically replaces the recipe's ingredient rows, so
    anything the caller didn't send is filled in from the recipe's current
    values -- model_fields_set (not None-checks) is what distinguishes "not
    sent" from "sent as null" for the genuinely nullable fields like
    description.
    """
    fetched = _fetch_recipe_and_ingredients(user_id, recipe_id)
    if fetched is None:
        raise RecipeNotFoundError
    existing_row, existing_ingredient_rows = fetched

    fields = body.model_fields_set
    ingredients: list[RecipeIngredientInput] = (
        body.ingredients
        if "ingredients" in fields and body.ingredients is not None
        else [
            RecipeIngredientInput(
                global_food_definition_id=row["global_food_definition_id"],
                quantity=row["quantity"],
                unit=row["unit"],
                note=row["note"],
            )
            for row in existing_ingredient_rows
        ]
    )

    client = get_service_client()
    try:
        client.rpc(
            "update_recipe",
            {
                "p_user_id": str(user_id),
                "p_recipe_id": str(recipe_id),
                "p_name": body.name if "name" in fields else existing_row["name"],
                "p_description": (
                    body.description if "description" in fields else existing_row["description"]
                ),
                "p_servings": (
                    body.servings if "servings" in fields else existing_row["servings"]
                ),
                "p_prep_time_minutes": (
                    body.prep_time_minutes
                    if "prep_time_minutes" in fields
                    else existing_row["prep_time_minutes"]
                ),
                "p_cook_time_minutes": (
                    body.cook_time_minutes
                    if "cook_time_minutes" in fields
                    else existing_row["cook_time_minutes"]
                ),
                "p_instructions": (
                    body.instructions
                    if "instructions" in fields
                    else existing_row["instructions"]
                ),
                "p_ingredients": [
                    {
                        "global_food_definition_id": str(ing.global_food_definition_id),
                        "quantity": str(ing.quantity),
                        "unit": ing.unit,
                        "note": ing.note,
                    }
                    for ing in ingredients
                ],
            },
        ).execute()
    except APIError as exc:
        if "RECIPE_NOT_FOUND" in str(exc):
            raise RecipeNotFoundError from exc
        raise
    return get_recipe(household_id, user_id, recipe_id)  # type: ignore[return-value]


def delete_recipe(user_id: UUID, recipe_id: UUID) -> bool:
    client = get_service_client()
    result = (
        client.table(_RECIPES_TABLE)
        .delete()
        .eq("created_by_user_id", str(user_id))
        .eq("id", str(recipe_id))
        .execute()
    )
    return bool(result.data)
