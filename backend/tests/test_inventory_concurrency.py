"""Concurrency guards on the live-until-frozen debt model (migration 0030):
the roster swap is one atomic RPC, and correct_item claims the item row
with a compare-and-swap before posting anything."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schemas.inventory_item import (
    CorrectInventoryItemRequest,
    InventoryItem,
    UpdateInventoryItemRequest,
)
from app.schemas.units import Unit
from app.services import inventory_items as inventory_service

_BASELINE_TS = "2026-01-01T00:00:00+00:00"


def _item(**overrides) -> InventoryItem:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=uuid.uuid4(),
        household_food_variant_id=uuid.uuid4(),
        storage_location_id=uuid.uuid4(),
        purchase_event_id=uuid.uuid4(),
        quantity=Decimal("100"),
        total_quantity=Decimal("100"),
        preferred_unit="count",
        cost=Decimal("4.00"),
        purchased_at=now,
        expiry_date=None,
        best_by_date=None,
        freeze_by_date=None,
        is_frozen=False,
        freeze_date=None,
        status="EMPTY",
        accounting_type="PERSONAL",
        split_member_count=None,
        debt_frozen_at=now,
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


# --------------------------------------------------------------------------
# A. Roster swap goes through the atomic RPC
# --------------------------------------------------------------------------


class _RpcRecorder:
    def __init__(self) -> None:
        self.rpc_calls: list[tuple[str, dict]] = []
        self.table_names: list[str] = []

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        return self

    def table(self, name):
        self.table_names.append(name)
        return self

    def update(self, *_a, **_k):
        return self

    def delete(self, *_a, **_k):
        return self

    def insert(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        return type("R", (), {"data": [{}]})()


def test_roster_edit_uses_the_atomic_rpc(monkeypatch) -> None:
    item = _item(accounting_type="SHARED", split_member_count=2, debt_frozen_at=None)
    m1, m2, m3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    client = _RpcRecorder()

    monkeypatch.setattr(inventory_service, "get_by_id", lambda hh, iid: item)
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: client)

    inventory_service.update_item(
        item.household_id,
        item.id,
        UpdateInventoryItemRequest(allowed_member_ids=[m1, m2, m3]),
    )

    assert client.rpc_calls == [
        (
            "set_inventory_item_roster",
            {
                "p_household_id": str(item.household_id),
                "p_item_id": str(item.id),
                "p_member_ids": [str(m1), str(m2), str(m3)],
            },
        )
    ]
    # No hand-rolled delete/insert on inventory_item_allowed_members.
    assert "inventory_item_allowed_members" not in client.table_names


# --------------------------------------------------------------------------
# B. correct_item compare-and-swap
# --------------------------------------------------------------------------


class _CasClient:
    """Fakes just enough for correct_item's quantity-only path. The item-row
    UPDATE (the claim) returns whatever `claim_data` says; the
    purchase_corrections insert is recorded."""

    def __init__(self, *, claim_data: list) -> None:
        self.claim_data = claim_data
        self.corrections: list[dict] = []
        self._table: str | None = None
        self._is_update = False

    def table(self, name):
        self._table = name
        self._is_update = False
        return self

    def update(self, _payload):
        self._is_update = True
        return self

    def insert(self, row):
        if self._table == "purchase_corrections":
            self.corrections.append(row)
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        if self._table == "inventory_items" and self._is_update:
            return type("R", (), {"data": self.claim_data})()
        return type("R", (), {"data": [{}]})()


def _frozen_item() -> InventoryItem:
    return _item(status="EMPTY", accounting_type="PERSONAL", debt_frozen_at=datetime.now(UTC))


def test_correction_raises_when_the_cas_claim_matches_nothing(monkeypatch) -> None:
    item = _frozen_item()
    client = _CasClient(claim_data=[])  # someone corrected first -> updated_at moved

    monkeypatch.setattr(inventory_service, "get_by_id", lambda hh, iid: item)
    monkeypatch.setattr(
        inventory_service,
        "_raw_base",
        lambda hh, iid: (Decimal("100"), Decimal("100"), Unit.COUNT, _BASELINE_TS),
    )
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: client)

    with pytest.raises(inventory_service.ConcurrentModificationError):
        inventory_service.correct_item(
            item.household_id,
            uuid.uuid4(),
            item.id,
            CorrectInventoryItemRequest(new_total_quantity=Decimal("120")),
        )
    # Nothing written when the claim loses the race.
    assert client.corrections == []


def test_correction_proceeds_when_the_cas_claim_wins(monkeypatch) -> None:
    item = _frozen_item()
    client = _CasClient(claim_data=[{}])

    monkeypatch.setattr(inventory_service, "get_by_id", lambda hh, iid: item)
    monkeypatch.setattr(
        inventory_service,
        "_raw_base",
        lambda hh, iid: (Decimal("100"), Decimal("100"), Unit.COUNT, _BASELINE_TS),
    )
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: client)

    inventory_service.correct_item(
        item.household_id,
        uuid.uuid4(),
        item.id,
        CorrectInventoryItemRequest(new_total_quantity=Decimal("120")),
    )
    assert len(client.corrections) == 1
    assert client.corrections[0]["new_total_quantity"] == "120"
