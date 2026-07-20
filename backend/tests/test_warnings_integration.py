"""Integration test for the warnings endpoint against the real linked
Supabase project -- confirms the enriched-select/status-filter plumbing
warnings.py relies on (inventory_items.list_for_household) actually behaves
as expected against real rows, not just the mocked unit tests in
test_warnings_computation.py. Excluded from the default run; run explicitly
with `uv run pytest -m integration`.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.integration

_PASSWORD = "Burrow-Warnings-Test-123!"


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def household(api_client):
    suffix = uuid.uuid4().hex[:8]
    user = await create_test_user(f"burrow-warnings-test-{suffix}@example.com", _PASSWORD)
    token = await sign_in(user["email"], _PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    household_resp = await api_client.post(
        "/api/households",
        json={"name": "Warnings Test House", "nickname": "Tester"},
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


async def _search_milk(api_client, headers) -> str:
    response = await api_client.get(
        "/api/food-definitions/search", params={"query": "Whole Milk"}, headers=headers
    )
    return response.json()["data"][0]["id"]


async def _create_item(api_client, household, **overrides) -> dict:
    milk_id = await _search_milk(api_client, household["headers"])
    body = {
        "global_food_definition_id": milk_id,
        "storage_location_id": household["storage_location_id"],
        "quantity": "10",
        "preferred_unit": "unit",
        "cost": "10.00",
        "allowed_member_ids": [household["member_id"]],
        "accounting_type": "PERSONAL",
    }
    body.update(overrides)
    response = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json=body,
        headers=household["headers"],
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _warnings(api_client, household) -> dict:
    response = await api_client.get(
        f"/api/households/{household['household_id']}/warnings",
        headers=household["headers"],
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def test_item_expiring_soon_is_flagged(api_client, household) -> None:
    item = await _create_item(
        api_client, household, expiry_date=(date.today() + timedelta(days=1)).isoformat()
    )

    warnings = await _warnings(api_client, household)

    assert len(warnings["expiry_warnings"]) == 1
    assert warnings["expiry_warnings"][0]["type"] == "EXPIRING_SOON"
    assert warnings["expiry_warnings"][0]["inventory_item_id"] == item["id"]


async def test_item_without_expiry_dates_is_not_flagged(api_client, household) -> None:
    await _create_item(api_client, household)

    warnings = await _warnings(api_client, household)

    assert warnings["expiry_warnings"] == []


async def test_consuming_down_to_low_stock_is_flagged(api_client, household) -> None:
    item = await _create_item(api_client, household, quantity="10")

    consume = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items/{item['id']}/consume",
        json={"quantity_used": "9"},
        headers=household["headers"],
    )
    assert consume.status_code == 200, consume.text

    warnings = await _warnings(api_client, household)

    assert len(warnings["stock_warnings"]) == 1
    assert warnings["stock_warnings"][0]["type"] == "LOW_STOCK"
    assert Decimal(warnings["stock_warnings"][0]["remaining_quantity"]) == Decimal("1")
    assert Decimal(warnings["stock_warnings"][0]["reference_quantity"]) == Decimal("10")


async def test_consuming_to_zero_is_out_of_stock(api_client, household) -> None:
    item = await _create_item(api_client, household, quantity="10")

    consume = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items/{item['id']}/consume",
        json={"quantity_used": "10"},
        headers=household["headers"],
    )
    assert consume.status_code == 200, consume.text

    warnings = await _warnings(api_client, household)

    assert len(warnings["stock_warnings"]) == 1
    assert warnings["stock_warnings"][0]["type"] == "OUT_OF_STOCK"


async def test_healthy_stock_is_not_flagged(api_client, household) -> None:
    await _create_item(api_client, household, quantity="10")

    warnings = await _warnings(api_client, household)

    assert warnings["stock_warnings"] == []
