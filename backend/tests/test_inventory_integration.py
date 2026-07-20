"""Integration tests against the real linked Supabase project.

Exercises the actual Postgres RPCs and triggers from migrations 0004-0006
(get-or-create variant, atomic quantity cap, usage_count bump, immutability,
auto-EMPTY transition) — none of this logic lives in Python, so it can't be
verified with mocks. Excluded from the default run (see pyproject.toml);
run explicitly with `uv run pytest -m integration`.
"""

import asyncio
import uuid
from decimal import Decimal

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.integration

_PASSWORD = "Burrow-Integration-Test-123!"


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def household(api_client):
    """A real user + household + storage location, torn down afterward."""
    suffix = uuid.uuid4().hex[:8]
    user = await create_test_user(f"burrow-inventory-test-{suffix}@example.com", _PASSWORD)
    token = await sign_in(user["email"], _PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    household_resp = await api_client.post(
        "/api/households",
        json={"name": "Inventory Test House", "nickname": "Tester"},
        headers=headers,
    )
    assert household_resp.status_code == 201, household_resp.text
    household_id = household_resp.json()["data"]["id"]

    members_resp = await api_client.get(f"/api/households/{household_id}/members", headers=headers)
    member_id = members_resp.json()["data"][0]["id"]

    storage_resp = await api_client.post(
        f"/api/households/{household_id}/storage-locations",
        json={"name": "Test Fridge", "type": "FRIDGE"},
        headers=headers,
    )
    storage_location_id = storage_resp.json()["data"]["id"]

    yield {
        "household_id": household_id,
        "member_id": member_id,
        "storage_location_id": storage_location_id,
        "headers": headers,
    }

    await api_client.delete(f"/api/households/{household_id}", headers=headers)
    await delete_test_user(user["id"])


async def _search_milk(api_client, headers) -> str:
    response = await api_client.get(
        "/api/food-definitions/search", params={"query": "Whole Milk"}, headers=headers
    )
    assert response.status_code == 200, response.text
    results = response.json()["data"]
    assert results, "seed data should contain 'Whole Milk'"
    return results[0]["id"]


async def test_full_add_consume_discard_lifecycle(api_client, household) -> None:
    headers = household["headers"]
    settings = get_settings()

    milk_id = await _search_milk(api_client, headers)

    async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
        before = await rest.get(
            "/rest/v1/global_food_definitions",
            params={"id": f"eq.{milk_id}", "select": "usage_count"},
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
        )
    usage_before = before.json()[0]["usage_count"]

    create_resp = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": milk_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": "5",
            "preferred_unit": "count",
            "cost": "4.99",
            "allowed_member_ids": [household["member_id"]],
        },
        headers=headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    item = create_resp.json()["data"]
    assert Decimal(item["quantity"]) == Decimal("5")
    assert item["status"] == "ACTIVE"
    # Not just "some string" — confirms the food-name join actually resolved
    # rather than silently falling back to the "Unknown food" default.
    assert item["food_name"] == "Whole Milk"
    assert item["storage_location_name"] == "Test Fridge"

    # usage_count bump trigger fired
    async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
        after = await rest.get(
            "/rest/v1/global_food_definitions",
            params={"id": f"eq.{milk_id}", "select": "usage_count"},
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
        )
    assert after.json()[0]["usage_count"] == usage_before + 1

    # Consuming more than remaining is rejected, not silently capped.
    over_resp = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items/{item['id']}/consume",
        json={"quantity_used": "10"},
        headers=headers,
    )
    assert over_resp.status_code == 400
    unchanged = await api_client.get(
        f"/api/households/{household['household_id']}/inventory-items/{item['id']}", headers=headers
    )
    assert Decimal(unchanged.json()["data"]["quantity"]) == Decimal("5")

    # Consume the exact remaining amount — should auto-transition to EMPTY.
    consume_resp = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items/{item['id']}/consume",
        json={"quantity_used": "5"},
        headers=headers,
    )
    assert consume_resp.status_code == 200
    assert Decimal(consume_resp.json()["data"]["quantity"]) == Decimal("0")
    assert consume_resp.json()["data"]["status"] == "EMPTY"


async def test_concurrent_consumption_only_one_wins(api_client, household) -> None:
    headers = household["headers"]
    milk_id = await _search_milk(api_client, headers)

    create_resp = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": milk_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": "1",
            "preferred_unit": "count",
            "cost": "1.00",
            "allowed_member_ids": [household["member_id"]],
        },
        headers=headers,
    )
    item_id = create_resp.json()["data"]["id"]

    async def consume_one():
        return await api_client.post(
            f"/api/households/{household['household_id']}/inventory-items/{item_id}/consume",
            json={"quantity_used": "1"},
            headers=headers,
        )

    results = await asyncio.gather(consume_one(), consume_one())
    statuses = sorted(r.status_code for r in results)

    # Exactly one request should succeed; the other must be rejected, not
    # both silently succeeding and driving quantity negative.
    assert statuses == [200, 400]

    final = await api_client.get(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}", headers=headers
    )
    assert Decimal(final.json()["data"]["quantity"]) == Decimal("0")


async def test_purchase_event_is_immutable(api_client, household) -> None:
    headers = household["headers"]
    settings = get_settings()
    milk_id = await _search_milk(api_client, headers)

    create_resp = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": milk_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": "1",
            "preferred_unit": "count",
            "cost": "1.00",
            "allowed_member_ids": [household["member_id"]],
        },
        headers=headers,
    )
    purchase_event_id = create_resp.json()["data"]["purchase_event_id"]

    async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
        response = await rest.patch(
            "/rest/v1/purchase_events",
            params={"id": f"eq.{purchase_event_id}"},
            json={"total_cost": 999},
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Prefer": "return=representation",
            },
        )

    # The BEFORE UPDATE trigger raises, which PostgREST surfaces as an error.
    assert response.status_code >= 400


async def test_discard_then_cannot_discard_again(api_client, household) -> None:
    headers = household["headers"]
    milk_id = await _search_milk(api_client, headers)

    create_resp = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": milk_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": "1",
            "preferred_unit": "count",
            "cost": "1.00",
            "allowed_member_ids": [household["member_id"]],
        },
        headers=headers,
    )
    item_id = create_resp.json()["data"]["id"]

    first = await api_client.delete(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}",
        params={"reason": "EXPIRED"},
        headers=headers,
    )
    assert first.status_code == 200
    assert first.json()["data"]["status"] == "EXPIRED"

    second = await api_client.delete(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}",
        params={"reason": "LOST"},
        headers=headers,
    )
    assert second.status_code == 404
