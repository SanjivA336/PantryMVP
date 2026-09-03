"""correct_consumption: append-only CORRECTION rows, quantity recomputed as
a maintained cache, ADJUSTMENT entries only when the item's already frozen."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schemas.consumption import RecordConsumptionCorrectionRequest
from app.schemas.inventory_item import InventoryItem
from app.schemas.member import Member
from app.schemas.units import Unit
from app.services import inventory_items as inventory_service

_BASELINE_TS = "2026-01-01T00:00:00+00:00"
_EVENT_ID = uuid.uuid4()
_MEMBER_ID = uuid.uuid4()


def _member() -> Member:
    now = datetime.now(UTC)
    return Member(
        id=uuid.uuid4(),
        household_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        nickname="Caller",
        is_admin=False,
        is_active=True,
        created_at=now,
        updated_at=now,
    )


def _item(**overrides) -> InventoryItem:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=uuid.uuid4(),
        household_food_variant_id=uuid.uuid4(),
        storage_location_id=uuid.uuid4(),
        purchase_event_id=uuid.uuid4(),
        quantity=Decimal("6"),
        total_quantity=Decimal("10"),
        preferred_unit="count",
        cost=Decimal("10.00"),
        purchased_at=now,
        expiry_date=None,
        best_by_date=None,
        freeze_by_date=None,
        is_frozen=False,
        freeze_date=None,
        status="ACTIVE",
        accounting_type="SHARED",
        split_member_count=2,
        debt_frozen_at=None,
        created_at=now,
        updated_at=now,
        name_override=None,
        food_name="Eggs",
        food_type_name="Eggs",
        category=None,
        storage_location_name="Fridge",
        allowed_member_ids=[],
    )
    defaults.update(overrides)
    return InventoryItem(**defaults)


class _R:
    def __init__(self, data):
        self.data = data


class _FakeClient:
    def __init__(self, *, original, priors=None, claim_data=None):
        self.original = original
        self.priors = priors or []
        self.claim_data = [{}] if claim_data is None else claim_data
        self.inserted: list[dict] = []
        self._table = None
        self._sel = None
        self._is_update = False
        self._eqs: dict = {}

    def table(self, name):
        self._table = name
        self._sel = None
        self._is_update = False
        self._eqs = {}
        return self

    def select(self, cols="*", *_a, **_k):
        self._sel = cols
        return self

    def update(self, payload):
        self._is_update = True
        self._payload = payload
        return self

    def insert(self, row):
        if self._table == "consumption_events":
            self.inserted.append(row)
        return self

    def eq(self, col, val):
        self._eqs[col] = val
        return self

    def maybe_single(self):
        return self

    def execute(self):
        if self._table == "consumption_events" and not self._is_update:
            if self._sel and "kind" in str(self._sel):
                return _R(self.original)
            if "corrects_event_id" in self._eqs:
                return _R(self.priors)
            return _R([{}])  # the CORRECTION insert
        if self._table == "inventory_items" and self._is_update:
            return _R(self.claim_data)
        return _R([])


@pytest.fixture
def patched(monkeypatch):
    calls = {"adjustments": 0, "freeze": 0}
    monkeypatch.setattr(
        inventory_service,
        "_post_usage_correction_adjustments",
        lambda *a, **k: calls.__setitem__("adjustments", calls["adjustments"] + 1),
    )
    monkeypatch.setattr(
        inventory_service.accounting_service,
        "freeze_item_debt",
        lambda _id: calls.__setitem__("freeze", calls["freeze"] + 1),
    )
    return calls


def _run(monkeypatch, *, item, client, actual):
    monkeypatch.setattr(inventory_service, "get_by_id", lambda hh, iid: item)
    monkeypatch.setattr(
        inventory_service,
        "_raw_base",
        lambda hh, iid: (
            Decimal(str(item.quantity)),
            Decimal(str(item.total_quantity)),
            Unit.COUNT,
            _BASELINE_TS,
        ),
    )
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: client)
    return inventory_service.correct_consumption(
        item.household_id,
        _member(),
        item.id,
        RecordConsumptionCorrectionRequest(
            corrects_event_id=_EVENT_ID, actual_quantity=Decimal(str(actual))
        ),
    )


def test_live_item_correction_writes_signed_delta_and_recomputes_quantity(
    monkeypatch, patched
) -> None:
    item = _item(quantity=Decimal("6"), total_quantity=Decimal("10"), debt_frozen_at=None)
    client = _FakeClient(
        original={"member_id": str(_MEMBER_ID), "quantity_used": "4", "kind": "USAGE"}
    )

    _run(monkeypatch, item=item, client=client, actual="1")

    # Logged 4, actually 1 -> delta -3.
    (event,) = client.inserted
    assert event["kind"] == "CORRECTION"
    assert Decimal(event["quantity_used"]) == Decimal("-3")
    assert event["corrects_event_id"] == str(_EVENT_ID)
    assert event["member_id"] == str(_MEMBER_ID)
    # quantity was 6, Σusage drops by 3 -> remaining 9.
    assert Decimal(client._payload["quantity"]) == Decimal("9")
    # Live item: no re-split.
    assert patched["adjustments"] == 0
    assert patched["freeze"] == 0


def test_frozen_item_correction_posts_adjustments(monkeypatch, patched) -> None:
    item = _item(quantity=Decimal("0"), status="EMPTY", debt_frozen_at=datetime.now(UTC))
    client = _FakeClient(
        original={"member_id": str(_MEMBER_ID), "quantity_used": "4", "kind": "USAGE"}
    )

    _run(monkeypatch, item=item, client=client, actual="1")

    assert len(client.inserted) == 1
    assert patched["adjustments"] == 1


def test_second_correction_measures_from_the_effective_value(monkeypatch, patched) -> None:
    item = _item(quantity=Decimal("6"), debt_frozen_at=None)
    client = _FakeClient(
        original={"member_id": str(_MEMBER_ID), "quantity_used": "4", "kind": "USAGE"},
        priors=[{"quantity_used": "-3"}],  # already corrected 4 -> 1
    )

    _run(monkeypatch, item=item, client=client, actual="2")

    # Effective is 1 (4 + -3); correcting to 2 -> delta +1.
    (event,) = client.inserted
    assert Decimal(event["quantity_used"]) == Decimal("1")


def test_no_op_correction_is_rejected(monkeypatch, patched) -> None:
    item = _item(debt_frozen_at=None)
    client = _FakeClient(
        original={"member_id": str(_MEMBER_ID), "quantity_used": "4", "kind": "USAGE"}
    )
    with pytest.raises(ValueError):
        _run(monkeypatch, item=item, client=client, actual="4")


def test_over_usage_correction_is_rejected(monkeypatch, patched) -> None:
    # quantity 6, logged 4; correcting to 11 means +7 usage -> remaining -1.
    item = _item(quantity=Decimal("6"), total_quantity=Decimal("10"), debt_frozen_at=None)
    client = _FakeClient(
        original={"member_id": str(_MEMBER_ID), "quantity_used": "4", "kind": "USAGE"}
    )
    with pytest.raises(ValueError):
        _run(monkeypatch, item=item, client=client, actual="11")


def test_targeting_a_non_usage_event_is_not_found(monkeypatch, patched) -> None:
    item = _item(debt_frozen_at=None)
    client = _FakeClient(
        original={"member_id": str(_MEMBER_ID), "quantity_used": "-1", "kind": "CORRECTION"}
    )
    with pytest.raises(inventory_service.ConsumptionEventNotFoundError):
        _run(monkeypatch, item=item, client=client, actual="1")


def test_cas_claim_loss_raises_conflict(monkeypatch, patched) -> None:
    item = _item(debt_frozen_at=None)
    client = _FakeClient(
        original={"member_id": str(_MEMBER_ID), "quantity_used": "4", "kind": "USAGE"},
        claim_data=[],  # updated_at moved under us
    )
    with pytest.raises(inventory_service.ConcurrentModificationError):
        _run(monkeypatch, item=item, client=client, actual="1")
    assert client.inserted == []
