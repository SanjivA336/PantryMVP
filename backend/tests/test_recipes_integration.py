"""Integration tests for recipes against the real linked Supabase project --
in particular the create/update RPCs' atomic ingredient replacement, and the
binary (plus bonus-quantity-when-units-match) availability matching against
live inventory. Excluded from the default run; run explicitly with
`uv run pytest -m integration`.
"""

import uuid
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.integration

_PASSWORD = "Burrow-Recipes-Test-123!"


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def household(api_client):
    suffix = uuid.uuid4().hex[:8]
    user = await create_test_user(f"burrow-recipes-test-{suffix}@example.com", _PASSWORD)
    token = await sign_in(user["email"], _PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    household_resp = await api_client.post(
        "/api/households",
        json={"name": "Recipes Test House", "nickname": "Tester"},
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


async def _buy(api_client, household, global_food_definition_id: str, quantity: str, unit: str):
    response = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": global_food_definition_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": quantity,
            "preferred_unit": unit,
            "cost": "5.00",
            "allowed_member_ids": [household["member_id"]],
            "accounting_type": "PERSONAL",
        },
        headers=household["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _create_recipe(api_client, household, ingredients: list[dict], **overrides) -> dict:
    body = {
        "name": "Pancakes",
        "servings": 4,
        "prep_time_minutes": 10,
        "cook_time_minutes": 15,
        "instructions": ["Mix everything", "Cook on a griddle"],
        "ingredients": ingredients,
    }
    body.update(overrides)
    response = await api_client.post(
        f"/api/households/{household['household_id']}/recipes",
        json=body,
        headers=household["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _get_recipe(api_client, household, recipe_id: str) -> dict:
    response = await api_client.get(
        f"/api/households/{household['household_id']}/recipes/{recipe_id}",
        headers=household["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_create_recipe_and_fetch_detail_in_order(api_client, household) -> None:
    milk = await _search_food(api_client, household["headers"], "Whole Milk")
    butter = await _search_food(api_client, household["headers"], "Butter")

    recipe = await _create_recipe(
        api_client,
        household,
        ingredients=[
            {"global_food_definition_id": milk["id"], "quantity": "2", "unit": "cup"},
            {
                "global_food_definition_id": butter["id"],
                "quantity": "50",
                "unit": "g",
                "note": "melted",
            },
        ],
    )

    assert recipe["name"] == "Pancakes"
    assert len(recipe["ingredients"]) == 2
    assert recipe["ingredients"][0]["food_name"] == "Whole Milk"
    assert recipe["ingredients"][0]["position"] == 0
    assert recipe["ingredients"][1]["food_name"] == "Butter"
    assert recipe["ingredients"][1]["note"] == "melted"


async def test_ingredient_unavailable_when_never_purchased(api_client, household) -> None:
    butter = await _search_food(api_client, household["headers"], "Butter")

    recipe = await _create_recipe(
        api_client,
        household,
        ingredients=[{"global_food_definition_id": butter["id"], "quantity": "50", "unit": "g"}],
    )

    assert recipe["ingredients"][0]["available"] is False
    assert recipe["ingredients"][0]["available_quantity"] is None


async def test_ingredient_available_with_quantity_when_units_match(api_client, household) -> None:
    butter = await _search_food(api_client, household["headers"], "Butter")
    await _buy(api_client, household, butter["id"], "200", "g")

    recipe = await _create_recipe(
        api_client,
        household,
        ingredients=[{"global_food_definition_id": butter["id"], "quantity": "50", "unit": "g"}],
    )

    ingredient = recipe["ingredients"][0]
    assert ingredient["available"] is True
    assert Decimal(ingredient["available_quantity"]) == Decimal("200")


async def test_ingredient_available_without_quantity_when_units_differ(
    api_client, household
) -> None:
    butter = await _search_food(api_client, household["headers"], "Butter")
    await _buy(api_client, household, butter["id"], "200", "g")

    recipe = await _create_recipe(
        api_client,
        household,
        ingredients=[{"global_food_definition_id": butter["id"], "quantity": "1", "unit": "stick"}],
    )

    ingredient = recipe["ingredients"][0]
    assert ingredient["available"] is True
    assert ingredient["available_quantity"] is None


async def test_update_recipe_replaces_ingredients(api_client, household) -> None:
    milk = await _search_food(api_client, household["headers"], "Whole Milk")
    butter = await _search_food(api_client, household["headers"], "Butter")
    recipe = await _create_recipe(
        api_client,
        household,
        ingredients=[{"global_food_definition_id": milk["id"], "quantity": "2", "unit": "cup"}],
    )

    update_resp = await api_client.patch(
        f"/api/households/{household['household_id']}/recipes/{recipe['id']}",
        json={
            "name": "Buttered Toast",
            "servings": 2,
            "instructions": ["Toast", "Butter it"],
            "ingredients": [
                {"global_food_definition_id": butter["id"], "quantity": "10", "unit": "g"}
            ],
        },
        headers=household["headers"],
    )
    assert update_resp.status_code == 200, update_resp.text

    updated = await _get_recipe(api_client, household, recipe["id"])
    assert updated["name"] == "Buttered Toast"
    assert len(updated["ingredients"]) == 1
    assert updated["ingredients"][0]["food_name"] == "Butter"


async def test_delete_recipe_removes_it(api_client, household) -> None:
    milk = await _search_food(api_client, household["headers"], "Whole Milk")
    recipe = await _create_recipe(
        api_client,
        household,
        ingredients=[{"global_food_definition_id": milk["id"], "quantity": "2", "unit": "cup"}],
    )

    delete_resp = await api_client.delete(
        f"/api/households/{household['household_id']}/recipes/{recipe['id']}",
        headers=household["headers"],
    )
    assert delete_resp.status_code == 200

    get_resp = await api_client.get(
        f"/api/households/{household['household_id']}/recipes/{recipe['id']}",
        headers=household["headers"],
    )
    assert get_resp.status_code == 404
