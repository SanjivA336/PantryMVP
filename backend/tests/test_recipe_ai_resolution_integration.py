"""Integration test for recipe_ai._resolve_ingredient_food_ids against the
real linked Supabase project -- the AI-ingredient-to-food-definition linking
feature has no coverage otherwise, since it queries household_food_variants
and global_food_definitions directly. Excluded from the default run; run
explicitly with `uv run pytest -m integration`.
"""

import uuid
from uuid import UUID

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.schemas.recipe_ai import DraftRecipe, DraftRecipeIngredient
from app.services.recipe_ai import _resolve_ingredient_food_ids
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.integration

_PASSWORD = "Burrow-RecipeAiLink-Test-123!"


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def household(api_client):
    suffix = uuid.uuid4().hex[:8]
    user = await create_test_user(f"burrow-recipe-ai-link-test-{suffix}@example.com", _PASSWORD)
    token = await sign_in(user["email"], _PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    household_resp = await api_client.post(
        "/api/households",
        json={"name": "Recipe AI Link Test House", "nickname": "Tester"},
        headers=headers,
    )
    household_id = household_resp.json()["data"]["id"]
    member_id = (
        await api_client.get(f"/api/households/{household_id}/members", headers=headers)
    ).json()["data"][0]["id"]
    storage_location_id = (
        await api_client.post(
            f"/api/households/{household_id}/storage-locations",
            json={"name": "Test Fridge", "type": "FRIDGE"},
            headers=headers,
        )
    ).json()["data"]["id"]

    yield {
        "household_id": household_id,
        "member_id": member_id,
        "storage_location_id": storage_location_id,
        "headers": headers,
    }

    await api_client.delete(f"/api/households/{household_id}", headers=headers)
    await delete_test_user(user["id"])


async def _search_food(api_client, headers, query: str) -> dict:
    response = await api_client.get(
        "/api/food-definitions/search", params={"query": query}, headers=headers
    )
    return response.json()["data"][0]


def _draft(*names: str) -> DraftRecipe:
    return DraftRecipe(
        name="Test recipe",
        instructions=["Do the thing"],
        ingredients=[DraftRecipeIngredient(name=n) for n in names],
    )


async def test_ingredient_matching_household_inventory_is_preferred(
    api_client, household
) -> None:
    butter = await _search_food(api_client, household["headers"], "Butter")
    await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": butter["id"],
            "storage_location_id": household["storage_location_id"],
            "quantity": "1",
            "preferred_unit": "g",
            "cost": "3.00",
            "allowed_member_ids": [household["member_id"]],
            "accounting_type": "PERSONAL",
        },
        headers=household["headers"],
    )

    draft = _draft("Butter")
    _resolve_ingredient_food_ids(UUID(household["household_id"]), draft)

    assert draft.ingredients[0].global_food_definition_id == UUID(butter["id"])


async def test_ingredient_falls_back_to_global_catalog(api_client, household) -> None:
    butter = await _search_food(api_client, household["headers"], "Butter")

    # No inventory item for Butter in this household -- should still match
    # via the wider global catalog search.
    draft = _draft("Butter")
    _resolve_ingredient_food_ids(UUID(household["household_id"]), draft)

    assert draft.ingredients[0].global_food_definition_id == UUID(butter["id"])


async def test_unmatched_ingredient_name_stays_unlinked(api_client, household) -> None:
    draft = _draft(f"Definitely Not A Real Food {uuid.uuid4().hex[:8]}")
    _resolve_ingredient_food_ids(UUID(household["household_id"]), draft)

    assert draft.ingredients[0].global_food_definition_id is None


async def test_case_insensitive_exact_match(api_client, household) -> None:
    await _search_food(api_client, household["headers"], "Butter")  # ensures it exists

    draft = _draft("BUTTER")
    _resolve_ingredient_food_ids(UUID(household["household_id"]), draft)

    assert draft.ingredients[0].global_food_definition_id is not None
