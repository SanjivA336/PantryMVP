"""Canonical base-unit storage (migration 0028): the service layer converts
display<->base at every boundary, and a metric<->customary swap no longer
touches the stored quantity."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from app.schemas.inventory_item import InventoryItem, UpdateInventoryItemRequest
from app.schemas.units import Unit
from app.services import inventory_items as inventory_service


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
        preferred_unit="oz",
        cost=Decimal("3.00"),
        purchased_at=now,
        expiry_date=None,
        best_by_date=None,
        freeze_by_date=None,
        is_frozen=False,
        freeze_date=None,
        status="ACTIVE",
        accounting_type="PERSONAL",
        split_member_count=None,
        debt_frozen_at=None,
        created_at=now,
        updated_at=now,
        name_override=None,
        food_name="Flour",
        food_type_name="Flour",
        category=None,
        storage_location_name="Pantry",
        allowed_member_ids=[],
    )
    defaults.update(overrides)
    return InventoryItem(**defaults)


class _CapturingClient:
    """Records the payload passed to .table(...).update(...)."""

    def __init__(self) -> None:
        self.updates: list[dict] = []

    def table(self, _name):
        return self

    def update(self, payload):
        self.updates.append(payload)
        return self

    def eq(self, *_a, **_k):
        return self

    def execute(self):
        return type("R", (), {"data": [{}]})()


def test_unit_system_swap_writes_only_display_unit(monkeypatch) -> None:
    """The regression this migration exists for: flipping oz<->g used to
    rewrite quantity/total_quantity through a multiply/divide (drift on
    every toggle). Now it's a pure display change."""
    item = _item(preferred_unit="oz", quantity=Decimal("100"), total_quantity=Decimal("100"))
    client = _CapturingClient()

    monkeypatch.setattr(inventory_service, "get_by_id", lambda hh, iid: item)
    monkeypatch.setattr(inventory_service, "_remember_measurement_choice", lambda *a, **k: None)
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: client)

    inventory_service.update_item(
        item.household_id, item.id, UpdateInventoryItemRequest(preferred_unit="g")
    )

    assert client.updates == [{"display_unit": "g"}]


def test_total_quantity_edit_is_applied_in_base_units(monkeypatch) -> None:
    """body.total_quantity arrives in the item's display unit (oz); the
    additive delta and the write are in base grams."""
    item = _item(preferred_unit="oz")
    client = _CapturingClient()

    # Raw row: 100 oz on hand of a 200 oz purchase, in base grams.
    monkeypatch.setattr(inventory_service, "get_by_id", lambda hh, iid: item)
    monkeypatch.setattr(
        inventory_service,
        "_raw_base",
        lambda hh, iid: (
            Decimal("2834.95"),  # 100 oz remaining, in g
            Decimal("5669.90"),  # 200 oz total, in g
            Unit.OZ,
        ),
    )
    monkeypatch.setattr(inventory_service, "get_service_client", lambda: client)

    # "It was actually a 300 oz purchase the whole time" -> +100 oz to both.
    inventory_service.update_item(
        item.household_id, item.id, UpdateInventoryItemRequest(total_quantity=Decimal("300"))
    )

    (payload,) = client.updates
    # 300 oz -> 8504.85 g total; remaining 100 oz + 100 oz delta = 200 oz -> 5669.90 g.
    assert Decimal(payload["total_quantity"]) == Decimal("300") * Decimal("28.3495")
    assert Decimal(payload["quantity"]) == Decimal("200") * Decimal("28.3495")
