import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schemas.settlement import RecordSettlementRequest, SettlementRecord
from app.services import settlements as settlements_service
from tests.conftest import auth_header, make_member


def _record(household_id: uuid.UUID, **overrides) -> SettlementRecord:
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        payer_member_id=uuid.uuid4(),
        payee_member_id=uuid.uuid4(),
        amount=Decimal("10.00"),
        note=None,
        recorded_by_member_id=uuid.uuid4(),
        reverses_settlement_id=None,
        created_at=datetime.now(UTC),
    )
    defaults.update(overrides)
    return SettlementRecord(**defaults)


@pytest.fixture
def fake_settlements(monkeypatch):
    store: dict[uuid.UUID, list[SettlementRecord]] = {}

    def list_records(household_id):
        return store.get(household_id, [])

    def record_settlement(household_id, recorded_by, body):
        rec = _record(
            household_id,
            payer_member_id=body.payer_member_id,
            payee_member_id=body.payee_member_id,
            amount=body.amount,
            note=body.note,
            recorded_by_member_id=recorded_by.id,
        )
        store.setdefault(household_id, []).append(rec)
        return rec

    def reverse_settlement(household_id, recorded_by, settlement_id):
        rows = store.get(household_id, [])
        original = next((r for r in rows if r.id == settlement_id), None)
        if original is None:
            raise settlements_service.SettlementNotFoundError
        if any(r.reverses_settlement_id == settlement_id for r in rows):
            raise settlements_service.AlreadyReversedError
        reversal = _record(
            household_id,
            payer_member_id=original.payee_member_id,
            payee_member_id=original.payer_member_id,
            amount=original.amount,
            recorded_by_member_id=recorded_by.id,
            reverses_settlement_id=settlement_id,
        )
        rows.append(reversal)
        return reversal

    monkeypatch.setattr("app.services.settlements.list_records", list_records)
    monkeypatch.setattr("app.services.settlements.record_settlement", record_settlement)
    monkeypatch.setattr("app.services.settlements.reverse_settlement", reverse_settlement)
    return store


# --------------------------------------------------------------------------
# Router: authorization + wiring
# --------------------------------------------------------------------------


async def test_non_member_cannot_list_settlement_records(
    client, fake_members, fake_settlements
) -> None:
    response = await client.get(
        f"/api/households/{uuid.uuid4()}/ledger/settlement-records",
        headers=auth_header(uuid.uuid4()),
    )
    assert response.status_code == 403


async def test_non_member_cannot_record_a_settlement(
    client, fake_members, fake_settlements
) -> None:
    response = await client.post(
        f"/api/households/{uuid.uuid4()}/ledger/settlement-records",
        headers=auth_header(uuid.uuid4()),
        json={
            "payer_member_id": str(uuid.uuid4()),
            "payee_member_id": str(uuid.uuid4()),
            "amount": "12.50",
        },
    )
    assert response.status_code == 403


async def test_member_records_then_lists_a_settlement(
    client, fake_members, fake_settlements, captured_activity
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    caller = fake_members.seed(make_member(household_id, user_id))
    payer, payee = uuid.uuid4(), uuid.uuid4()

    post = await client.post(
        f"/api/households/{household_id}/ledger/settlement-records",
        headers=auth_header(user_id),
        json={
            "payer_member_id": str(payer),
            "payee_member_id": str(payee),
            "amount": "12.50",
            "note": "venmo",
        },
    )
    assert post.status_code == 200
    assert post.json()["data"]["amount"] == "12.50"
    assert post.json()["data"]["recorded_by_member_id"] == str(caller.id)

    listed = await client.get(
        f"/api/households/{household_id}/ledger/settlement-records",
        headers=auth_header(user_id),
    )
    assert [r["note"] for r in listed.json()["data"]] == ["venmo"]


async def test_amount_must_be_positive(client, fake_members, fake_settlements) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/ledger/settlement-records",
        headers=auth_header(user_id),
        json={
            "payer_member_id": str(uuid.uuid4()),
            "payee_member_id": str(uuid.uuid4()),
            "amount": "0",
        },
    )
    assert response.status_code == 422


async def test_reverse_is_idempotent_guarded(client, fake_members, fake_settlements) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    seeded = _record(household_id)
    fake_settlements[household_id] = [seeded]

    first = await client.delete(
        f"/api/households/{household_id}/ledger/settlement-records/{seeded.id}",
        headers=auth_header(user_id),
    )
    assert first.status_code == 200
    assert first.json()["data"]["reverses_settlement_id"] == str(seeded.id)

    second = await client.delete(
        f"/api/households/{household_id}/ledger/settlement-records/{seeded.id}",
        headers=auth_header(user_id),
    )
    assert second.status_code == 409


async def test_reverse_unknown_settlement_is_404(client, fake_members, fake_settlements) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.delete(
        f"/api/households/{household_id}/ledger/settlement-records/{uuid.uuid4()}",
        headers=auth_header(user_id),
    )
    assert response.status_code == 404


# --------------------------------------------------------------------------
# Service: record_settlement / reverse_settlement business rules
# --------------------------------------------------------------------------


class _FakeInsert:
    def __init__(self, sink):
        self._sink = sink

    def insert(self, row):
        self._sink["inserted"] = row
        return self

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def maybe_single(self):
        return self

    def execute(self):
        row = dict(self._sink["inserted"])
        row.setdefault("id", str(uuid.uuid4()))
        row.setdefault("created_at", datetime.now(UTC).isoformat())
        row.setdefault("note", None)
        row.setdefault("reverses_settlement_id", None)
        return type("R", (), {"data": [row]})()


class _FakeClient:
    def __init__(self, sink):
        self._sink = sink

    def table(self, _name):
        return _FakeInsert(self._sink)


def test_record_settlement_rejects_a_non_member(monkeypatch) -> None:
    household_id = uuid.uuid4()
    recorder = make_member(household_id, uuid.uuid4())
    stranger = uuid.uuid4()

    monkeypatch.setattr(
        "app.services.settlements.members_service.list_members",
        lambda hh: [recorder],
    )
    monkeypatch.setattr("app.services.settlements.get_service_client", lambda: _FakeClient({}))
    monkeypatch.setattr("app.services.settlements.activity_service.record", lambda *a, **k: None)

    with pytest.raises(settlements_service.MemberNotInHouseholdError):
        settlements_service.record_settlement(
            household_id,
            recorder,
            RecordSettlementRequest(
                payer_member_id=recorder.id,
                payee_member_id=stranger,
                amount=Decimal("5"),
            ),
        )
