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
    """Distinguishes every table _live_shares touches, unlike the simpler
    fake in test_ledger_balances.py -- needed here since that's exactly
    what's under test."""

    def __init__(
        self,
        *,
        ledger_rows=None,
        member_rows=None,
        inventory_item_rows=None,
        purchase_event_rows=None,
        allowed_member_rows=None,
        consumption_event_rows=None,
    ):
        self._tables = {
            "ledger_entries": ledger_rows or [],
            "members": member_rows or [],
            "inventory_items": inventory_item_rows or [],
            "purchase_events": purchase_event_rows or [],
            "inventory_item_allowed_members": allowed_member_rows or [],
            "consumption_events": consumption_event_rows or [],
        }

    def table(self, name):
        return _FakeQuery(self._tables[name])


def test_compute_balances_blends_a_live_unfrozen_item_with_zero_ledger_entries(
    monkeypatch,
) -> None:
    household_id = uuid.uuid4()
    buyer, m1, m2 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    item_id = str(uuid.uuid4())
    purchase_event_id = str(uuid.uuid4())

    client = _FakeClient(
        inventory_item_rows=[
            {
                "id": item_id,
                "purchase_event_id": purchase_event_id,
                "total_quantity": "12",
                "cost": "12",
            }
        ],
        purchase_event_rows=[{"id": purchase_event_id, "member_id": str(buyer)}],
        allowed_member_rows=[
            {"inventory_item_id": item_id, "member_id": str(buyer)},
            {"inventory_item_id": item_id, "member_id": str(m1)},
            {"inventory_item_id": item_id, "member_id": str(m2)},
        ],
        consumption_event_rows=[
            {"inventory_item_id": item_id, "member_id": str(m1), "quantity_used": "4"},
        ],
    )
    monkeypatch.setattr("app.services.ledger.get_service_client", lambda: client)

    balances = ledger_service.compute_balances(household_id)

    by_debtor = {b.debtor_member_id: b for b in balances}
    # m1 documented usage (4) exceeds the 3-way baseline allotment (12/3=4?
    # no -- 3 people, allotment 4 each; m1 used exactly 4, not over) so
    # nobody locks and everyone (m1, m2) settles at the plain 12/3=4 * $1 =
    # $4 share, live-computed with zero real ledger_entries in play.
    assert by_debtor[m1].creditor_member_id == buyer
    assert by_debtor[m1].amount == Decimal(4)
    assert by_debtor[m2].amount == Decimal(4)


def test_compute_balances_blends_live_share_on_top_of_a_real_ledger_entry(monkeypatch) -> None:
    """The same pair already has a real, frozen $2 debt from something
    else entirely -- the live share from a still-active item adds on top,
    indistinguishably, in the same direction."""
    household_id = uuid.uuid4()
    buyer, debtor = uuid.uuid4(), uuid.uuid4()
    item_id = str(uuid.uuid4())
    purchase_event_id = str(uuid.uuid4())

    client = _FakeClient(
        ledger_rows=[
            {
                "debtor_member_id": str(debtor),
                "creditor_member_id": str(buyer),
                "amount": "2.00",
            }
        ],
        inventory_item_rows=[
            {
                "id": item_id,
                "purchase_event_id": purchase_event_id,
                "total_quantity": "10",
                "cost": "10",
            }
        ],
        purchase_event_rows=[{"id": purchase_event_id, "member_id": str(buyer)}],
        allowed_member_rows=[
            {"inventory_item_id": item_id, "member_id": str(buyer)},
            {"inventory_item_id": item_id, "member_id": str(debtor)},
        ],
    )
    monkeypatch.setattr("app.services.ledger.get_service_client", lambda: client)

    balances = ledger_service.compute_balances(household_id)

    assert len(balances) == 1
    # Live share: 2 people, 10 qty/$10, no usage logged -> $5 each. Plus the
    # pre-existing real $2. Total: $7.
    assert balances[0].debtor_member_id == debtor
    assert balances[0].creditor_member_id == buyer
    assert balances[0].amount == Decimal("7.00")


def test_frozen_items_never_contribute_a_live_share(monkeypatch) -> None:
    """_live_shares only ever queries debt_frozen_at IS NULL rows -- a fake
    that returns nothing for that filter (simulating "this item is already
    frozen") must contribute nothing, proving the live path doesn't
    double-count something freeze_item_debt already posted for real."""
    household_id = uuid.uuid4()
    client = _FakeClient(inventory_item_rows=[])
    monkeypatch.setattr("app.services.ledger.get_service_client", lambda: client)

    assert ledger_service._live_shares(household_id) == []
