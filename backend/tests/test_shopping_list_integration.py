"""Integration tests for the shopping list against the real linked Supabase
project -- in particular the "Suggest List" dismissal rule (a removed
suggestion should not silently reappear next time you click Suggest List,
unless you've bought that food again since). Excluded from the default run;
run explicitly with `uv run pytest -m integration`.
"""

import uuid

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.integration

_PASSWORD = "Burrow-ShoppingList-Test-123!"


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def household(api_client):
    suffix = uuid.uuid4().hex[:8]
    user = await create_test_user(f"burrow-shoplist-test-{suffix}@example.com", _PASSWORD)
    token = await sign_in(user["email"], _PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    household_resp = await api_client.post(
        "/api/households",
        json={"name": "Shopping List Test House", "nickname": "Tester"},
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


async def _search_butter(api_client, headers) -> str:
    response = await api_client.get(
        "/api/food-definitions/search", params={"query": "Butter"}, headers=headers
    )
    return response.json()["data"][0]["id"]


async def _buy_butter(api_client, household, quantity: str) -> dict:
    butter_id = await _search_butter(api_client, household["headers"])
    response = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": butter_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": quantity,
            "preferred_unit": "g",
            "cost": "5.00",
            "allowed_member_ids": [household["member_id"]],
            "accounting_type": "PERSONAL",
        },
        headers=household["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _consume(api_client, household, item_id: str, quantity: str):
    response = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}/consume",
        json={"quantity_used": quantity},
        headers=household["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _suggest(api_client, household) -> list[dict]:
    response = await api_client.post(
        f"/api/households/{household['household_id']}/shopping-list/suggest",
        headers=household["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _active_items(api_client, household) -> list[dict]:
    response = await api_client.get(
        f"/api/households/{household['household_id']}/shopping-list/items",
        headers=household["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_manual_item_add_and_remove_lifecycle(api_client, household) -> None:
    section_resp = await api_client.post(
        f"/api/households/{household['household_id']}/shopping-list/sections",
        json={"name": "Household"},
        headers=household["headers"],
    )
    section_id = section_resp.json()["data"]["id"]

    create_resp = await api_client.post(
        f"/api/households/{household['household_id']}/shopping-list/items",
        json={"name": "Paper towels", "section_id": section_id},
        headers=household["headers"],
    )
    assert create_resp.status_code == 201, create_resp.text
    item = create_resp.json()["data"]
    assert item["source"] == "MANUAL"
    assert item["section_id"] == section_id

    active = await _active_items(api_client, household)
    assert any(i["id"] == item["id"] for i in active)

    remove_resp = await api_client.delete(
        f"/api/households/{household['household_id']}/shopping-list/items/{item['id']}",
        headers=household["headers"],
    )
    assert remove_resp.status_code == 200
    assert remove_resp.json()["data"]["status"] == "REMOVED"

    active_after = await _active_items(api_client, household)
    assert not any(i["id"] == item["id"] for i in active_after)


async def test_suggest_creates_item_for_low_stock_food(api_client, household) -> None:
    item = await _buy_butter(api_client, household, "10")
    await _consume(api_client, household, item["id"], "9")

    suggested = await _suggest(api_client, household)

    assert len(suggested) == 1
    assert suggested[0]["source"] == "SUGGESTED"
    assert suggested[0]["name"] == "Butter"
    assert suggested[0]["household_food_variant_id"] == item["household_food_variant_id"]


async def test_suggest_does_not_duplicate_already_active_suggestion(api_client, household) -> None:
    item = await _buy_butter(api_client, household, "10")
    await _consume(api_client, household, item["id"], "9")

    first = await _suggest(api_client, household)
    second = await _suggest(api_client, household)

    assert len(first) == 1
    assert second == []


async def test_suggest_skips_healthy_stock(api_client, household) -> None:
    await _buy_butter(api_client, household, "10")

    suggested = await _suggest(api_client, household)

    assert suggested == []


async def test_removed_suggestion_does_not_reappear_without_new_purchase(
    api_client, household
) -> None:
    item = await _buy_butter(api_client, household, "10")
    await _consume(api_client, household, item["id"], "9")

    first = await _suggest(api_client, household)
    assert len(first) == 1

    remove_resp = await api_client.delete(
        f"/api/households/{household['household_id']}/shopping-list/items/{first[0]['id']}",
        headers=household["headers"],
    )
    assert remove_resp.status_code == 200

    second = await _suggest(api_client, household)
    assert second == [], "a dismissed suggestion must not silently reappear"


async def test_removed_suggestion_reappears_after_new_purchase_runs_low_again(
    api_client, household
) -> None:
    # Buy 10, consume down to 1 -> low stock -> suggest -> dismiss.
    item_a = await _buy_butter(api_client, household, "10")
    await _consume(api_client, household, item_a["id"], "9")
    first = await _suggest(api_client, household)
    assert len(first) == 1
    await api_client.delete(
        f"/api/households/{household['household_id']}/shopping-list/items/{first[0]['id']}",
        headers=household["headers"],
    )
    assert (await _suggest(api_client, household)) == []

    # Buy 10 more (a new purchase, newer than the dismissal) -> total on hand
    # is now 1 + 10 = 11, healthy relative to the new 10-unit reference.
    item_b = await _buy_butter(api_client, household, "10")
    assert (await _suggest(api_client, household)) == []

    # Consume all of the new purchase -> back down to 1 total, but now
    # against a reference purchase that happened *after* the dismissal.
    await _consume(api_client, household, item_b["id"], "10")

    reappeared = await _suggest(api_client, household)
    assert len(reappeared) == 1
    assert reappeared[0]["name"] == "Butter"
