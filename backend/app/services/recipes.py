from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.recipe import (
    CreateRecipeRequest,
    Recipe,
    RecipeDetail,
    RecipeIngredient,
    UpdateRecipeRequest,
)
from app.schemas.units import Dimension, Unit
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

    Everything is stored in base units now (migration 0028), so on-hand
    stock and the ingredient's requirement are directly comparable whenever
    they're the same *dimension* -- a plain sum, no conversion. Stock that
    exists only in a different dimension (weight on hand, recipe wants
    volume) still can't be quantified without a density this app never asks
    for, so that falls back to a binary yes/no. available_quantity is
    returned in the ingredient's own display unit.
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

    # (base quantity, dimension) per active pantry item, grouped by variant.
    on_hand: dict[str, list[tuple[Decimal, Dimension]]] = {}
    if variant_ids:
        items = (
            client.table("inventory_items")
            .select("household_food_variant_id, quantity, display_unit")
            .eq("household_id", str(household_id))
            .eq("status", "ACTIVE")
            .in_("household_food_variant_id", variant_ids)
            .execute()
        )
        for row in items.data:
            base_qty = Decimal(str(row["quantity"]))
            dimension = units_service.guess_dimension(Unit(row["display_unit"]))
            on_hand.setdefault(row["household_food_variant_id"], []).append((base_qty, dimension))

    result: dict[UUID, tuple[bool, Decimal | None]] = {}
    for row in ingredient_rows:
        variant_id = variant_id_by_food_id.get(row["global_food_definition_id"])
        stock = on_hand.get(variant_id) if variant_id else None
        if not stock:
            result[UUID(row["id"])] = (False, None)
            continue

        ingredient_unit = Unit(row["display_unit"])
        ingredient_dimension = units_service.guess_dimension(ingredient_unit)
        same_dimension_base = sum(
            (qty for qty, dim in stock if dim == ingredient_dimension), Decimal(0)
        )
        if same_dimension_base > 0:
            result[UUID(row["id"])] = (
                True,
                units_service.display_quantity(same_dimension_base, ingredient_unit),
            )
        else:
            total_any_dimension = sum((qty for qty, _ in stock), Decimal(0))
            result[UUID(row["id"])] = (total_any_dimension > 0, None)

    return result


def _fetch_recipe_and_ingredients(user_id: UUID, recipe_id: UUID) -> tuple[dict, list[dict]] | None:
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
        # Stored in base units under `display_unit` (migration 0028) --
        # surface it in the user's unit under the schema's `unit` name, the
        # read boundary for recipes.
        display_unit = Unit(row.pop("display_unit"))
        base_quantity = Decimal(str(row.pop("quantity")))
        available, available_quantity = availability.get(UUID(row["id"]), (False, None))
        ingredients.append(
            RecipeIngredient(
                **row,
                unit=display_unit,
                quantity=units_service.display_quantity(base_quantity, display_unit),
                food_name=food.get("name", "Unknown food"),
                category=food.get("category"),
                available=available,
                available_quantity=available_quantity,
            )
        )

    return RecipeDetail(**recipe_row, ingredients=ingredients)


def create_recipe(household_id: UUID, user_id: UUID, body: CreateRecipeRequest) -> RecipeDetail:
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
                    # Persisted in base units; the RPC stores what it's given.
                    "quantity": str(units_service.to_base(ing.quantity, ing.unit)),
                    "unit": ing.unit.value,
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
    if "ingredients" in fields and body.ingredients is not None:
        # Caller-supplied, in display units -> convert to base.
        ingredient_payload = [
            {
                "global_food_definition_id": str(ing.global_food_definition_id),
                "quantity": str(units_service.to_base(ing.quantity, ing.unit)),
                "unit": ing.unit.value,
                "note": ing.note,
            }
            for ing in body.ingredients
        ]
    else:
        # Untouched rows -- already base, passed straight through. Round-
        # tripping them base->display->base would introduce drift on every
        # ingredient-less PATCH.
        ingredient_payload = [
            {
                "global_food_definition_id": str(row["global_food_definition_id"]),
                "quantity": str(row["quantity"]),
                "unit": row["display_unit"],
                "note": row["note"],
            }
            for row in existing_ingredient_rows
        ]

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
                "p_servings": (body.servings if "servings" in fields else existing_row["servings"]),
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
                    body.instructions if "instructions" in fields else existing_row["instructions"]
                ),
                "p_ingredients": ingredient_payload,
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
