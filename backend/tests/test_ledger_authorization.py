import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schemas.ledger_entry import LedgerBalance, LedgerEntry
from tests.conftest import auth_header, make_member


def _entry(household_id: uuid.UUID, **overrides) -> LedgerEntry:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        creditor_member_id=uuid.uuid4(),
        debtor_member_id=uuid.uuid4(),
        amount=Decimal("2.50"),
        reason="PURCHASE",
        source_purchase_event_id=uuid.uuid4(),
        source_consumption_event_id=None,
        settled_at=None,
        created_at=now,
    )
    defaults.update(overrides)
    return LedgerEntry(**defaults)


@pytest.fixture
def fake_ledger(monkeypatch):
    entries: dict[uuid.UUID, list[LedgerEntry]] = {}
    balances: dict[uuid.UUID, list[LedgerBalance]] = {}

    def list_entries(household_id):
        return entries.get(household_id, [])

    def compute_balances(household_id):
        return balances.get(household_id, [])

    monkeypatch.setattr("app.services.ledger.list_entries", list_entries)
    monkeypatch.setattr("app.services.ledger.compute_balances", compute_balances)

    return {"entries": entries, "balances": balances}


async def test_non_member_cannot_list_entries(client, fake_members, fake_ledger) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.get(
        f"/api/households/{household_id}/ledger/entries",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_list_entries(client, fake_members, fake_ledger) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    entry = _entry(household_id)
    fake_ledger["entries"][household_id] = [entry]

    response = await client.get(
        f"/api/households/{household_id}/ledger/entries",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert len(body) == 1
    assert body[0]["amount"] == "2.50"
    assert body[0]["reason"] == "PURCHASE"


async def test_non_member_cannot_view_balances(client, fake_members, fake_ledger) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.get(
        f"/api/households/{household_id}/ledger/balances",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_view_balances(client, fake_members, fake_ledger) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    debtor_id, creditor_id = uuid.uuid4(), uuid.uuid4()
    fake_ledger["balances"][household_id] = [
        LedgerBalance(
            debtor_member_id=debtor_id, creditor_member_id=creditor_id, amount=Decimal("1.75")
        )
    ]

    response = await client.get(
        f"/api/households/{household_id}/ledger/balances",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert len(body) == 1
    assert body[0]["amount"] == "1.75"
    assert body[0]["debtor_member_id"] == str(debtor_id)
    assert body[0]["creditor_member_id"] == str(creditor_id)
