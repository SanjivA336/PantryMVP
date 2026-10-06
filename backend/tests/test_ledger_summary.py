import threading
import uuid
from decimal import Decimal

from app.services import ledger as ledger_service
from tests.conftest import auth_header
from tests.conftest import make_member as _member

A, B, C = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def _row(debtor, creditor, amount) -> dict:
    return {
        "debtor_member_id": str(debtor),
        "creditor_member_id": str(creditor),
        "amount": amount,
    }


def _stub_reads(monkeypatch, rows=None, ghosts=None, items=None, deltas=None, shares=None) -> None:
    monkeypatch.setattr(ledger_service, "_ledger_balance_rows", lambda hid: rows or [])
    monkeypatch.setattr(ledger_service, "_ghost_member_ids", lambda hid: ghosts or set())
    monkeypatch.setattr(ledger_service, "_live_items", lambda hid: items or [])
    monkeypatch.setattr(ledger_service, "_recorded_settlement_deltas", lambda hid: deltas or [])
    monkeypatch.setattr(ledger_service, "_live_shares_from_items", lambda items: shares or [])


def test_compute_balances_issues_its_four_reads_at_the_same_time(monkeypatch) -> None:
    # Same barrier trick as the auth test: all four reads must be in flight
    # together for any of them to finish.
    barrier = threading.Barrier(4, timeout=3)

    def waits(value):
        def stub(_household_id):
            barrier.wait()
            return value

        return stub

    monkeypatch.setattr(ledger_service, "_ledger_balance_rows", waits([_row(A, B, "10")]))
    monkeypatch.setattr(ledger_service, "_ghost_member_ids", waits(set()))
    monkeypatch.setattr(ledger_service, "_live_items", waits([]))
    monkeypatch.setattr(ledger_service, "_recorded_settlement_deltas", waits([]))

    balances = ledger_service.compute_balances(uuid.uuid4())

    assert [(b.debtor_member_id, b.creditor_member_id, b.amount) for b in balances] == [
        (A, B, Decimal("10"))
    ]


def test_summary_balances_and_plan_match_the_separate_calculations(monkeypatch) -> None:
    # A owes B 10, B owes C 4: B nets +6, C +4, A -10, so A pays B 6 and C 4.
    _stub_reads(monkeypatch, rows=[_row(A, B, "10"), _row(B, C, "4")])
    household_id = uuid.uuid4()

    summary = ledger_service.compute_summary(household_id)

    assert summary.balances == ledger_service.compute_balances(household_id)
    assert summary.settlements == ledger_service.compute_settlements(household_id)
    plan = sorted((s.debtor_member_id, s.creditor_member_id, s.amount) for s in summary.settlements)
    assert plan == sorted([(A, B, Decimal("6")), (A, C, Decimal("4"))])


def test_summary_reads_the_database_only_once(monkeypatch) -> None:
    reads = {"n": 0}

    def counting_rows(_household_id):
        reads["n"] += 1
        return [_row(A, B, "10")]

    _stub_reads(monkeypatch)
    monkeypatch.setattr(ledger_service, "_ledger_balance_rows", counting_rows)

    ledger_service.compute_summary(uuid.uuid4())

    assert reads["n"] == 1


def test_a_cycle_of_debts_needs_no_transfers_in_the_summary(monkeypatch) -> None:
    _stub_reads(monkeypatch, rows=[_row(A, B, "10"), _row(B, C, "10"), _row(C, A, "10")])

    summary = ledger_service.compute_summary(uuid.uuid4())

    assert summary.settlements == []


async def test_summary_endpoint_requires_membership(client, fake_members) -> None:
    response = await client.get(
        f"/api/households/{uuid.uuid4()}/ledger/summary", headers=auth_header(uuid.uuid4())
    )

    assert response.status_code == 403


async def test_summary_endpoint_returns_both_halves(client, fake_members, monkeypatch) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(_member(household_id, user_id))
    _stub_reads(monkeypatch, rows=[_row(A, B, "10")])

    response = await client.get(
        f"/api/households/{household_id}/ledger/summary", headers=auth_header(user_id)
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert len(data["balances"]) == 1
    assert len(data["settlements"]) == 1
    assert Decimal(data["settlements"][0]["amount"]) == Decimal("10")
