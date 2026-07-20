"""Integration tests for the ledger settlement engine (migration 0009),
against the real linked Supabase project.

Every dollar amount here is hand-computed, not just "assert it changed" —
this is the highest-risk part of the whole build (real money-shaped
numbers), so the test gate has to actually pin the arithmetic, not just
smoke-test that requests succeed. Excluded from the default run (see
pyproject.toml); run explicitly with `uv run pytest -m integration`.
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

_PASSWORD = "Burrow-Ledger-Test-123!"


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _provision_household(api_client: AsyncClient, member_count: int) -> dict:
    """A real household with `member_count` real members (index 0 is the
    creator/buyer), plus one storage location. Torn down by the `provision`
    fixture below."""
    suffix = uuid.uuid4().hex[:8]
    creator = await create_test_user(f"burrow-ledger-test-{suffix}-0@example.com", _PASSWORD)
    creator_token = await sign_in(creator["email"], _PASSWORD)
    creator_headers = {"Authorization": f"Bearer {creator_token}"}

    household_resp = await api_client.post(
        "/api/households",
        json={"name": "Ledger Test House", "nickname": "Member0"},
        headers=creator_headers,
    )
    assert household_resp.status_code == 201, household_resp.text
    household_data = household_resp.json()["data"]
    household_id = household_data["id"]
    join_code = household_data["join_code"]

    members_resp = await api_client.get(
        f"/api/households/{household_id}/members", headers=creator_headers
    )
    creator_member_id = members_resp.json()["data"][0]["id"]

    users = [creator]
    member_ids = [creator_member_id]
    headers_list = [creator_headers]

    for i in range(1, member_count):
        user = await create_test_user(f"burrow-ledger-test-{suffix}-{i}@example.com", _PASSWORD)
        token = await sign_in(user["email"], _PASSWORD)
        headers = {"Authorization": f"Bearer {token}"}
        join_resp = await api_client.post(
            "/api/households/join",
            json={"join_code": join_code, "nickname": f"Member{i}"},
            headers=headers,
        )
        assert join_resp.status_code == 200, join_resp.text
        members_resp = await api_client.get(
            f"/api/households/{household_id}/members", headers=headers
        )
        this_member = next(m for m in members_resp.json()["data"] if m["nickname"] == f"Member{i}")
        users.append(user)
        member_ids.append(this_member["id"])
        headers_list.append(headers)

    storage_resp = await api_client.post(
        f"/api/households/{household_id}/storage-locations",
        json={"name": "Test Fridge", "type": "FRIDGE"},
        headers=creator_headers,
    )
    storage_location_id = storage_resp.json()["data"]["id"]

    return {
        "household_id": household_id,
        "member_ids": member_ids,
        "headers": headers_list,
        "storage_location_id": storage_location_id,
        "users": users,
    }


@pytest.fixture
async def provision(api_client):
    created: list[dict] = []

    async def _make(member_count: int) -> dict:
        household = await _provision_household(api_client, member_count)
        created.append(household)
        return household

    yield _make

    for household in created:
        await api_client.delete(
            f"/api/households/{household['household_id']}", headers=household["headers"][0]
        )
        for user in household["users"]:
            await delete_test_user(user["id"])


async def _search_milk(api_client: AsyncClient, headers: dict) -> str:
    response = await api_client.get(
        "/api/food-definitions/search", params={"query": "Whole Milk"}, headers=headers
    )
    assert response.status_code == 200, response.text
    results = response.json()["data"]
    assert results, "seed data should contain 'Whole Milk'"
    return results[0]["id"]


async def _create_item(
    api_client: AsyncClient,
    household: dict,
    *,
    quantity: str,
    cost: str,
    allowed_member_indices: list[int],
    accounting_type: str,
) -> dict:
    milk_id = await _search_milk(api_client, household["headers"][0])
    response = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": milk_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": quantity,
            "preferred_unit": "unit",
            "cost": cost,
            "allowed_member_ids": [household["member_ids"][i] for i in allowed_member_indices],
            "accounting_type": accounting_type,
        },
        headers=household["headers"][0],
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _consume(
    api_client: AsyncClient, household: dict, item_id: str, member_index: int, quantity: str
) -> httpx.Response:
    return await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}/consume",
        json={"quantity_used": quantity},
        headers=household["headers"][member_index],
    )


async def _entries(api_client: AsyncClient, household: dict) -> list[dict]:
    response = await api_client.get(
        f"/api/households/{household['household_id']}/ledger/entries",
        headers=household["headers"][0],
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


async def _balances(api_client: AsyncClient, household: dict) -> list[dict]:
    response = await api_client.get(
        f"/api/households/{household['household_id']}/ledger/balances",
        headers=household["headers"][0],
    )
    assert response.status_code == 200, response.text
    return response.json()["data"]


def _sum_between(entries: list[dict], reason: str, creditor: str, debtor: str) -> Decimal:
    return sum(
        (
            Decimal(e["amount"])
            for e in entries
            if e["reason"] == reason
            and e["creditor_member_id"] == creditor
            and e["debtor_member_id"] == debtor
        ),
        Decimal(0),
    )


# ---------------------------------------------------------------------------
# Core arithmetic scenarios
# ---------------------------------------------------------------------------


async def test_worked_example_exact_numbers(api_client, provision) -> None:
    """3 members (A buyer, B, C), UNIT_BASED, cost=12/qty=12 -> $1/unit,
    allotment=4 each. B consumes exactly its allotment (no overage). C
    consumes 6 (2 over its allotment); A and B are the slack pool, but B
    has already used its allotment (slack=0), so A absorbs 100% of C's
    $2.00 overage. Hand-computed expected entries below."""
    household = await provision(3)
    item = await _create_item(
        api_client,
        household,
        quantity="12",
        cost="12.00",
        allowed_member_indices=[0, 1, 2],
        accounting_type="UNIT_BASED",
    )
    a, b, c = household["member_ids"]

    consume_b = await _consume(api_client, household, item["id"], 1, "4")
    assert consume_b.status_code == 200, consume_b.text

    consume_c = await _consume(api_client, household, item["id"], 2, "6")
    assert consume_c.status_code == 200, consume_c.text

    entries = await _entries(api_client, household)

    assert _sum_between(entries, "PURCHASE", a, b) == Decimal("4.00")
    assert _sum_between(entries, "PURCHASE", a, c) == Decimal("4.00")
    assert _sum_between(entries, "OVERAGE", a, c) == Decimal("2.00")
    # B stayed within its allotment -> no OVERAGE entries at all involving B.
    assert not any(
        e["reason"] == "OVERAGE" and b in (e["creditor_member_id"], e["debtor_member_id"])
        for e in entries
    )
    assert len(entries) == 3

    balances = await _balances(api_client, household)
    by_pair = {
        (bal["debtor_member_id"], bal["creditor_member_id"]): Decimal(bal["amount"])
        for bal in balances
    }
    assert by_pair[(b, a)] == Decimal("4.00")
    assert by_pair[(c, a)] == Decimal("6.00")


async def test_exact_allotment_produces_no_overage(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0, 1],
        accounting_type="UNIT_BASED",
    )

    consume = await _consume(api_client, household, item["id"], 1, "5")
    assert consume.status_code == 200, consume.text

    entries = await _entries(api_client, household)
    assert [e["reason"] for e in entries] == ["PURCHASE"]
    assert Decimal(entries[0]["amount"]) == Decimal("5.00")


async def test_overage_fully_absorbed_by_single_slack_holder(api_client, provision) -> None:
    household = await provision(2)
    a, b = household["member_ids"]
    item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0, 1],
        accounting_type="UNIT_BASED",
    )

    consume = await _consume(api_client, household, item["id"], 1, "8")
    assert consume.status_code == 200, consume.text

    entries = await _entries(api_client, household)
    assert _sum_between(entries, "PURCHASE", a, b) == Decimal("5.00")
    # B's allotment is 5; consuming 8 is 3 over -> A (the only other allowed
    # member, with full 5 of unused slack) absorbs the entire $3.00.
    assert _sum_between(entries, "OVERAGE", a, b) == Decimal("3.00")
    assert len(entries) == 2


async def test_personal_item_produces_zero_ledger_entries(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client,
        household,
        quantity="5",
        cost="9.99",
        allowed_member_indices=[0],
        accounting_type="PERSONAL",
    )

    consume = await _consume(api_client, household, item["id"], 0, "5")
    assert consume.status_code == 200, consume.text

    entries = await _entries(api_client, household)
    assert entries == []


async def test_shared_consumable_equal_split_only_no_overage_ever(api_client, provision) -> None:
    household = await provision(2)
    a, b = household["member_ids"]
    item = await _create_item(
        api_client,
        household,
        quantity="100",
        cost="10.00",
        allowed_member_indices=[0, 1],
        accounting_type="SHARED_CONSUMABLE",
    )

    # One member consumes far beyond any notion of "their share" — should
    # never generate an OVERAGE entry, since that math only runs for
    # UNIT_BASED items.
    consume = await _consume(api_client, household, item["id"], 1, "90")
    assert consume.status_code == 200, consume.text

    entries = await _entries(api_client, household)
    assert [e["reason"] for e in entries] == ["PURCHASE"]
    assert _sum_between(entries, "PURCHASE", a, b) == Decimal("5.00")


async def test_zero_cost_item_produces_no_entries(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="0",
        allowed_member_indices=[0, 1],
        accounting_type="UNIT_BASED",
    )

    consume = await _consume(api_client, household, item["id"], 1, "10")
    assert consume.status_code == 200, consume.text

    entries = await _entries(api_client, household)
    assert entries == []


async def test_single_allowed_member_produces_no_entries(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0],
        accounting_type="UNIT_BASED",
    )

    consume = await _consume(api_client, household, item["id"], 0, "10")
    assert consume.status_code == 200, consume.text

    entries = await _entries(api_client, household)
    assert entries == []


# ---------------------------------------------------------------------------
# Concurrency and path-dependence
# ---------------------------------------------------------------------------


async def test_concurrent_consumption_total_overage_conserved(api_client, provision) -> None:
    """3 members, UNIT_BASED, cost=12/qty=12 -> $1/unit, allotment=4 each.
    B and C each consume 6 concurrently (2 over their own allotment) -- who
    ends up as creditor for which slice is order-dependent (see the pinned
    regression test below), but the *total* money moved via OVERAGE is not:
    each member's own overage_qty only depends on their own prior usage
    (which starts at 0 for both, regardless of interleaving), so the total
    is always 2 events * $2.00 = $4.00."""
    household = await provision(3)
    item = await _create_item(
        api_client,
        household,
        quantity="12",
        cost="12.00",
        allowed_member_indices=[0, 1, 2],
        accounting_type="UNIT_BASED",
    )

    results = await asyncio.gather(
        _consume(api_client, household, item["id"], 1, "6"),
        _consume(api_client, household, item["id"], 2, "6"),
    )
    assert [r.status_code for r in results] == [200, 200], [r.text for r in results]

    entries = await _entries(api_client, household)
    total_overage = sum(
        (Decimal(e["amount"]) for e in entries if e["reason"] == "OVERAGE"), Decimal(0)
    )
    assert total_overage == Decimal("4.00")

    final_item = await api_client.get(
        f"/api/households/{household['household_id']}/inventory-items/{item['id']}",
        headers=household["headers"][0],
    )
    assert Decimal(final_item.json()["data"]["quantity"]) == Decimal("0")


async def test_path_dependence_pinned_regression(api_client, provision) -> None:
    """Documented, intentional quirk: slack is recomputed fresh at each
    event from *current* cumulative usage, not reduced by previously
    donated credit. Two households, same final consumption (B=5, C=4) in
    different orders, produce different total credit to A -- $2.00 vs
    $2.50 -- even though total money moved is always fully accounted for
    and never exceeds any member's true slack. This is accepted, not a bug
    (see migration 0009's comments); pinned here so a future change to the
    settlement formula can't silently alter it without this test noticing.
    """
    # Order 1: B (5) then C (4).
    household1 = await provision(3)
    a1, b1, c1 = household1["member_ids"]
    item1 = await _create_item(
        api_client,
        household1,
        quantity="9",
        cost="9.00",
        allowed_member_indices=[0, 1, 2],
        accounting_type="UNIT_BASED",
    )
    assert (await _consume(api_client, household1, item1["id"], 1, "5")).status_code == 200
    assert (await _consume(api_client, household1, item1["id"], 2, "4")).status_code == 200
    entries1 = await _entries(api_client, household1)
    credit_to_a1 = sum(
        (
            Decimal(e["amount"])
            for e in entries1
            if e["reason"] == "OVERAGE" and e["creditor_member_id"] == a1
        ),
        Decimal(0),
    )

    # Order 2: C (4) then B (5) -- same final consumption, opposite order.
    household2 = await provision(3)
    a2, b2, c2 = household2["member_ids"]
    item2 = await _create_item(
        api_client,
        household2,
        quantity="9",
        cost="9.00",
        allowed_member_indices=[0, 1, 2],
        accounting_type="UNIT_BASED",
    )
    assert (await _consume(api_client, household2, item2["id"], 2, "4")).status_code == 200
    assert (await _consume(api_client, household2, item2["id"], 1, "5")).status_code == 200
    entries2 = await _entries(api_client, household2)
    credit_to_a2 = sum(
        (
            Decimal(e["amount"])
            for e in entries2
            if e["reason"] == "OVERAGE" and e["creditor_member_id"] == a2
        ),
        Decimal(0),
    )

    assert credit_to_a1 == Decimal("2.00")
    assert credit_to_a2 == Decimal("2.50")
    assert credit_to_a1 != credit_to_a2


# ---------------------------------------------------------------------------
# Finalization, immutability, single-writer, roster freeze
# ---------------------------------------------------------------------------


async def test_finalization_is_noop(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0, 1],
        accounting_type="UNIT_BASED",
    )
    assert (await _consume(api_client, household, item["id"], 1, "8")).status_code == 200

    before = await _entries(api_client, household)

    discard = await api_client.delete(
        f"/api/households/{household['household_id']}/inventory-items/{item['id']}",
        params={"reason": "DISCARDED"},
        headers=household["headers"][0],
    )
    assert discard.status_code == 200, discard.text

    after = await _entries(api_client, household)
    assert before == after


async def test_ledger_entries_are_immutable(api_client, provision) -> None:
    settings = get_settings()
    household = await provision(2)
    await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0, 1],
        accounting_type="UNIT_BASED",
    )
    entries = await _entries(api_client, household)
    entry_id = entries[0]["id"]

    async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
        response = await rest.patch(
            "/rest/v1/ledger_entries",
            params={"id": f"eq.{entry_id}"},
            json={"amount": 999},
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Prefer": "return=representation",
            },
        )

    assert response.status_code >= 400


async def test_ledger_single_writer_direct_insert_rejected(api_client, provision) -> None:
    settings = get_settings()
    household = await provision(2)

    async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
        response = await rest.post(
            "/rest/v1/ledger_entries",
            json={
                "household_id": household["household_id"],
                "creditor_member_id": household["member_ids"][0],
                "debtor_member_id": household["member_ids"][1],
                "amount": "1.00",
                "reason": "ADJUSTMENT",
            },
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": household["headers"][0]["Authorization"],
            },
        )

    assert response.status_code in (401, 403)


async def test_roster_frozen_for_non_personal_but_free_for_personal(api_client, provision) -> None:
    settings = get_settings()
    household = await provision(3)

    unit_based_item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0, 1],
        accounting_type="UNIT_BASED",
    )
    personal_item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0],
        accounting_type="PERSONAL",
    )

    async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
        frozen_attempt = await rest.post(
            "/rest/v1/inventory_item_allowed_members",
            json={
                "inventory_item_id": unit_based_item["id"],
                "member_id": household["member_ids"][2],
            },
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": household["headers"][0]["Authorization"],
            },
        )
        free_attempt = await rest.post(
            "/rest/v1/inventory_item_allowed_members",
            json={
                "inventory_item_id": personal_item["id"],
                "member_id": household["member_ids"][1],
            },
            headers={
                "apikey": settings.supabase_anon_key,
                "Authorization": household["headers"][0]["Authorization"],
                "Prefer": "return=representation",
            },
        )

    assert frozen_attempt.status_code in (401, 403)
    assert free_attempt.status_code == 201


async def test_balances_endpoint_reflects_net_amounts(api_client, provision) -> None:
    household = await provision(2)
    a, b = household["member_ids"]
    item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0, 1],
        accounting_type="UNIT_BASED",
    )
    assert (await _consume(api_client, household, item["id"], 1, "8")).status_code == 200

    balances = await _balances(api_client, household)
    assert len(balances) == 1
    assert balances[0]["debtor_member_id"] == b
    assert balances[0]["creditor_member_id"] == a
    assert Decimal(balances[0]["amount"]) == Decimal("8.00")
