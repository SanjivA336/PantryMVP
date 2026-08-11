import uuid
from decimal import Decimal

from app.services import ledger as ledger_service


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def is_(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def execute(self):
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, ledger_rows, member_rows=None):
        self._ledger_rows = ledger_rows
        self._member_rows = member_rows or []

    def table(self, name):
        if name == "members":
            return _FakeQuery(self._member_rows)
        if name == "ledger_entries":
            return _FakeQuery(self._ledger_rows)
        # inventory_items/purchase_events/inventory_item_allowed_members/
        # consumption_events -- these tests only exercise the real-ledger
        # netting path, not the live-share blend (see test_live_balances.py
        # for that), so nothing live to contribute here.
        return _FakeQuery([])


def _rows_to_client(rows: list[dict], member_rows: list[dict] | None = None) -> _FakeClient:
    return _FakeClient(rows, member_rows)


def test_balances_nets_opposite_direction_entries(monkeypatch) -> None:
    household_id = uuid.uuid4()
    a, b = uuid.uuid4(), uuid.uuid4()
    # a owes b $5 (from one purchase split), b owes a $3 (from an overage
    # event later) -- should net down to a single "a owes b $2" balance.
    rows = [
        {"debtor_member_id": str(a), "creditor_member_id": str(b), "amount": "5.00"},
        {"debtor_member_id": str(b), "creditor_member_id": str(a), "amount": "3.00"},
    ]
    monkeypatch.setattr("app.services.ledger.get_service_client", lambda: _rows_to_client(rows))

    balances = ledger_service.compute_balances(household_id)

    assert len(balances) == 1
    assert balances[0].debtor_member_id == a
    assert balances[0].creditor_member_id == b
    assert balances[0].amount == Decimal("2.00")


def test_balances_fully_cancel_to_nothing(monkeypatch) -> None:
    household_id = uuid.uuid4()
    a, b = uuid.uuid4(), uuid.uuid4()
    rows = [
        {"debtor_member_id": str(a), "creditor_member_id": str(b), "amount": "4.00"},
        {"debtor_member_id": str(b), "creditor_member_id": str(a), "amount": "4.00"},
    ]
    monkeypatch.setattr("app.services.ledger.get_service_client", lambda: _rows_to_client(rows))

    balances = ledger_service.compute_balances(household_id)

    assert balances == []


def test_balances_multiple_independent_pairs(monkeypatch) -> None:
    household_id = uuid.uuid4()
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rows = [
        {"debtor_member_id": str(a), "creditor_member_id": str(b), "amount": "10.00"},
        {"debtor_member_id": str(c), "creditor_member_id": str(a), "amount": "6.50"},
    ]
    monkeypatch.setattr("app.services.ledger.get_service_client", lambda: _rows_to_client(rows))

    balances = ledger_service.compute_balances(household_id)

    by_pair = {(bal.debtor_member_id, bal.creditor_member_id): bal.amount for bal in balances}
    assert by_pair[(a, b)] == Decimal("10.00")
    assert by_pair[(c, a)] == Decimal("6.50")


def test_balances_exclude_entries_involving_a_deleted_account(monkeypatch) -> None:
    household_id = uuid.uuid4()
    a, b, ghost = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    rows = [
        {"debtor_member_id": str(a), "creditor_member_id": str(b), "amount": "5.00"},
        # ghost's account has been deleted (member row survives with
        # user_id null) -- nobody can ever collect this $20, so it must
        # not show up as something to settle.
        {"debtor_member_id": str(ghost), "creditor_member_id": str(a), "amount": "20.00"},
    ]
    member_rows = [{"id": str(ghost)}]
    monkeypatch.setattr(
        "app.services.ledger.get_service_client", lambda: _rows_to_client(rows, member_rows)
    )

    balances = ledger_service.compute_balances(household_id)

    assert len(balances) == 1
    assert balances[0].debtor_member_id == a
    assert balances[0].creditor_member_id == b
    assert balances[0].amount == Decimal("5.00")


def test_balances_include_entries_for_merely_deactivated_members(monkeypatch) -> None:
    """A member who left/was kicked but whose account still exists (user_id
    still set) is a different case from a deleted account -- their debt
    might still be worth chasing outside the app, so it stays visible."""
    household_id = uuid.uuid4()
    a, left_member = uuid.uuid4(), uuid.uuid4()
    rows = [
        {"debtor_member_id": str(left_member), "creditor_member_id": str(a), "amount": "8.00"},
    ]
    monkeypatch.setattr(
        "app.services.ledger.get_service_client", lambda: _rows_to_client(rows, [])
    )

    balances = ledger_service.compute_balances(household_id)

    assert len(balances) == 1
    assert balances[0].debtor_member_id == left_member
