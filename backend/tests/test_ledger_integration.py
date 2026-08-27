"""Integration tests for the live-until-frozen debt model (migration 0024),
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
    accounting_type: str = "SHARED",
) -> dict:
    milk_id = await _search_milk(api_client, household["headers"][0])
    response = await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items",
        json={
            "global_food_definition_id": milk_id,
            "storage_location_id": household["storage_location_id"],
            "quantity": quantity,
            "preferred_unit": "count",
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


async def _discard(
    api_client: AsyncClient, household: dict, item_id: str, member_index: int = 0
) -> httpx.Response:
    return await api_client.delete(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}",
        params={"reason": "DISCARDED"},
        headers=household["headers"][member_index],
    )


async def _correct(
    api_client: AsyncClient,
    household: dict,
    item_id: str,
    *,
    new_cost: str,
    member_index: int = 0,
) -> httpx.Response:
    return await api_client.post(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}/corrections",
        json={"new_cost": new_cost, "note": "integration test correction"},
        headers=household["headers"][member_index],
    )


async def _patch(
    api_client: AsyncClient,
    household: dict,
    item_id: str,
    body: dict,
    member_index: int = 0,
) -> httpx.Response:
    return await api_client.patch(
        f"/api/households/{household['household_id']}/inventory-items/{item_id}",
        json=body,
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


def _net(balances: list[dict], debtor: str, creditor: str) -> Decimal:
    for bal in balances:
        if bal["debtor_member_id"] == debtor and bal["creditor_member_id"] == creditor:
            return Decimal(bal["amount"])
    return Decimal(0)


# ---------------------------------------------------------------------------
# Live-until-frozen lifecycle
# ---------------------------------------------------------------------------


async def test_item_creation_posts_nothing(api_client, provision) -> None:
    """Unlike the old immediate-billing model, creating a SHARED item must
    not touch the ledger at all -- nothing is owed until the item's story
    ends."""
    household = await provision(2)
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )
    assert item["debt_frozen_at"] is None

    entries = await _entries(api_client, household)
    assert entries == []


async def test_live_preview_matches_frozen_result_exactly(api_client, provision) -> None:
    """4 members (buyer A + B, C, D), qty=12/cost=12 -> $1/unit, allotment=3
    each. A (the buyer) uses 4, B uses 8 -- both exceed the *initial* 3-each
    allotment simultaneously, so both lock in the same cascade round at
    their real usage; the remaining 0 units leave C and D undocumented at a
    $0 share. The live preview (before the item empties) and the real,
    frozen ledger entries (after) must agree exactly -- nothing should
    change from the user's point of view when the item's story ends."""
    household = await provision(4)
    a, b, c, d = household["member_ids"]
    item = await _create_item(
        api_client, household, quantity="12", cost="12.00", allowed_member_indices=[0, 1, 2, 3]
    )

    assert (await _consume(api_client, household, item["id"], 0, "4")).status_code == 200

    # Only A has documented usage so far -- B, C, D are all still
    # undocumented at this point and split the remaining 8 evenly.
    live_balances = await _balances(api_client, household)
    assert _net(live_balances, b, a) == Decimal("2.666666666666666666666666667")
    assert _net(live_balances, c, a) == Decimal("2.666666666666666666666666667")
    assert _net(live_balances, d, a) == Decimal("2.666666666666666666666666667")
    assert (await _entries(api_client, household)) == []  # still nothing real

    drain = await _consume(api_client, household, item["id"], 1, "8")
    assert drain.status_code == 200
    assert drain.json()["data"]["status"] == "EMPTY"
    assert drain.json()["data"]["debt_frozen_at"] is not None

    frozen_balances = await _balances(api_client, household)
    assert _net(frozen_balances, b, a) == Decimal("8.0")
    assert _net(frozen_balances, c, a) == Decimal("0")
    assert _net(frozen_balances, d, a) == Decimal("0")

    entries = await _entries(api_client, household)
    assert len(entries) == 1
    assert entries[0]["reason"] == "PURCHASE"
    assert entries[0]["creditor_member_id"] == a
    assert entries[0]["debtor_member_id"] == b
    assert Decimal(entries[0]["amount"]) == Decimal("8.0")


async def test_undocumented_usage_splits_the_remaining_allotment_evenly(
    api_client, provision
) -> None:
    """2 members, nobody documents usage at all -- discarding (not
    consuming) still has to freeze a real, equal-split debt."""
    household = await provision(2)
    a, b = household["member_ids"]
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )

    discard = await _discard(api_client, household, item["id"])
    assert discard.status_code == 200, discard.text

    entries = await _entries(api_client, household)
    assert [e["reason"] for e in entries] == ["PURCHASE"]
    assert _sum_between(entries, "PURCHASE", a, b) == Decimal("5.00")


async def test_personal_item_never_freezes_or_posts(api_client, provision) -> None:
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
    assert consume.json()["data"]["status"] == "EMPTY"
    assert consume.json()["data"]["debt_frozen_at"] is None

    entries = await _entries(api_client, household)
    assert entries == []


async def test_zero_cost_item_produces_no_entries(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client, household, quantity="10", cost="0", allowed_member_indices=[0, 1]
    )

    discard = await _discard(api_client, household, item["id"])
    assert discard.status_code == 200, discard.text

    entries = await _entries(api_client, household)
    assert entries == []


async def test_single_allowed_member_produces_no_entries(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0]
    )

    consume = await _consume(api_client, household, item["id"], 0, "10")
    assert consume.status_code == 200, consume.text

    entries = await _entries(api_client, household)
    assert entries == []


# ---------------------------------------------------------------------------
# Live editing vs. post-freeze corrections
# ---------------------------------------------------------------------------


async def test_direct_edit_allowed_live_blocked_once_frozen(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )

    live_edit = await _patch(api_client, household, item["id"], {"cost": "12.00"})
    assert live_edit.status_code == 200, live_edit.text
    assert live_edit.json()["data"]["cost"] == "12.0"

    discard = await _discard(api_client, household, item["id"])
    assert discard.status_code == 200, discard.text

    frozen_edit = await _patch(api_client, household, item["id"], {"cost": "20.00"})
    assert frozen_edit.status_code == 409, frozen_edit.text


async def test_correction_rejected_before_freeze(api_client, provision) -> None:
    household = await provision(2)
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )

    correction = await _correct(api_client, household, item["id"], new_cost="5.00")
    assert correction.status_code == 400, correction.text


async def test_correction_adjusts_only_the_member_whose_usage_drove_the_original_split(
    api_client, provision
) -> None:
    """Regression test for a real bug caught in manual testing: the
    correction endpoint used to split a cost delta evenly across the whole
    roster, ignoring who actually drove the original bill. It must instead
    re-run the split against the item's real recorded usage, so a price
    correction only moves the share of whoever was actually over their
    allotment.

    3 members (buyer A, B, C), qty=12/cost=12.00 -> $1/unit, allotment=4
    each. B uses 8 (over allotment, locks at real usage); C never
    documents anything and settles at whatever's left ($0, since B's 8 plus
    A's assumed 4 already accounts for the full 12). A -3.00 cost
    correction should move only B's PURCHASE-derived debt -- C, who was
    never billed anything, must not receive any ADJUSTMENT entry at all.
    """
    household = await provision(3)
    a, b, c = household["member_ids"]
    item = await _create_item(
        api_client, household, quantity="12", cost="12.00", allowed_member_indices=[0, 1, 2]
    )

    assert (await _consume(api_client, household, item["id"], 0, "4")).status_code == 200
    drain = await _consume(api_client, household, item["id"], 1, "8")
    assert drain.status_code == 200
    assert drain.json()["data"]["status"] == "EMPTY"

    before = await _entries(api_client, household)
    assert _sum_between(before, "PURCHASE", a, b) == Decimal("8.0")
    assert _sum_between(before, "PURCHASE", a, c) == Decimal("0")

    correction = await _correct(api_client, household, item["id"], new_cost="9.00")
    assert correction.status_code == 200, correction.text

    after = await _entries(api_client, household)
    adjustments = [e for e in after if e["reason"] == "ADJUSTMENT"]
    assert len(adjustments) == 1
    assert adjustments[0]["creditor_member_id"] == b
    assert adjustments[0]["debtor_member_id"] == a
    assert Decimal(adjustments[0]["amount"]) == Decimal("2.0")

    balances = await _balances(api_client, household)
    assert _net(balances, b, a) == Decimal("6.0")
    assert _net(balances, c, a) == Decimal("0")


# ---------------------------------------------------------------------------
# Concurrency and immutability
# ---------------------------------------------------------------------------


async def test_concurrent_discard_freezes_exactly_once(api_client, provision) -> None:
    """Two requests racing to discard the same still-ACTIVE item must not
    both win: freeze_item_debt() claims the freeze with a compare-and-swap
    on debt_frozen_at (only-if-still-null) before posting anything, mirroring
    the atomic `.eq("status", "ACTIVE")` guard discard() itself already
    uses. Without that guard, both requests could independently observe the
    item as no-longer-ACTIVE and each post their own copy of the same
    PURCHASE entries -- silently doubling everyone's debt."""
    household = await provision(2)
    a, b = household["member_ids"]
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )
    assert (await _consume(api_client, household, item["id"], 1, "8")).status_code == 200

    results = await asyncio.gather(
        _discard(api_client, household, item["id"]),
        _discard(api_client, household, item["id"]),
    )
    statuses = sorted(r.status_code for r in results)
    # Exactly one wins the atomic ACTIVE->DISCARDED transition; the other
    # finds nothing left to discard.
    assert statuses == [200, 404], [r.text for r in results]

    entries = await _entries(api_client, household)
    purchase_entries = [e for e in entries if e["reason"] == "PURCHASE"]
    assert len(purchase_entries) == 1
    assert _sum_between(entries, "PURCHASE", a, b) == Decimal("8.00")


async def test_ledger_entries_are_immutable(api_client, provision) -> None:
    settings = get_settings()
    household = await provision(2)
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )
    assert (await _discard(api_client, household, item["id"])).status_code == 200
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


async def test_roster_editable_while_live_frozen_once_debt_finalized(api_client, provision) -> None:
    """SHARED roster edits are free while the item's debt is still live
    (nothing posted yet, so nothing to protect), but blocked once frozen,
    same as cost/quantity. PERSONAL items stay free forever regardless.

    Checked via INSERT (a WITH CHECK failure is a real 401/403), not
    DELETE -- an RLS-blocked DELETE just matches zero rows and still
    returns 204, so it can't distinguish "blocked" from "nothing to
    delete" the way a blocked INSERT can.
    """
    settings = get_settings()
    household = await provision(3)

    live_item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )
    frozen_item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )
    personal_item = await _create_item(
        api_client,
        household,
        quantity="10",
        cost="10.00",
        allowed_member_indices=[0],
        accounting_type="PERSONAL",
    )
    assert (await _discard(api_client, household, frozen_item["id"])).status_code == 200

    async def _try_add(item_id: str, member_index: int) -> httpx.Response:
        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
            return await rest.post(
                "/rest/v1/inventory_item_allowed_members",
                json={
                    "inventory_item_id": item_id,
                    "member_id": household["member_ids"][member_index],
                },
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": household["headers"][0]["Authorization"],
                    "Prefer": "return=representation",
                },
            )

    live_attempt = await _try_add(live_item["id"], 2)
    frozen_attempt = await _try_add(frozen_item["id"], 2)
    personal_attempt = await _try_add(personal_item["id"], 1)

    assert live_attempt.status_code == 201, live_attempt.text
    assert frozen_attempt.status_code in (401, 403), frozen_attempt.text
    assert personal_attempt.status_code == 201, personal_attempt.text


async def test_balances_endpoint_reflects_net_amounts(api_client, provision) -> None:
    household = await provision(2)
    a, b = household["member_ids"]
    item = await _create_item(
        api_client, household, quantity="10", cost="10.00", allowed_member_indices=[0, 1]
    )
    assert (await _consume(api_client, household, item["id"], 1, "8")).status_code == 200
    assert (await _discard(api_client, household, item["id"])).status_code == 200

    balances = await _balances(api_client, household)
    assert len(balances) == 1
    assert balances[0]["debtor_member_id"] == b
    assert balances[0]["creditor_member_id"] == a
    assert Decimal(balances[0]["amount"]) == Decimal("8.00")
