import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from app.schemas.inventory_item import InventoryItem
from app.services import warnings as warnings_service


def _item(*, variant_id=None, purchased_at=None, **overrides) -> InventoryItem:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=uuid.uuid4(),
        household_food_variant_id=variant_id or uuid.uuid4(),
        storage_location_id=uuid.uuid4(),
        purchase_event_id=uuid.uuid4(),
        quantity=Decimal("5"),
        total_quantity=Decimal("5"),
        preferred_unit="count",
        cost=Decimal("4.99"),
        purchased_at=purchased_at or now,
        expiry_date=None,
        best_by_date=None,
        freeze_by_date=None,
        is_frozen=False,
        freeze_date=None,
        status="ACTIVE",
        accounting_type="PERSONAL",
        split_member_count=None,
        created_at=now,
        updated_at=now,
        food_name="Whole Milk",
        storage_location_name="Test Fridge",
    )
    defaults.update(overrides)
    return InventoryItem(**defaults)


def _compute(monkeypatch, items):
    monkeypatch.setattr(
        "app.services.warnings.inventory_service.list_for_household", lambda hh: items
    )
    return warnings_service.compute_warnings(uuid.uuid4())


def test_item_expiring_within_window_is_flagged(monkeypatch) -> None:
    item = _item(expiry_date=date.today() + timedelta(days=2))
    result = _compute(monkeypatch, [item])

    assert len(result.expiry_warnings) == 1
    assert result.expiry_warnings[0].type == "EXPIRING_SOON"
    assert result.expiry_warnings[0].inventory_item_id == item.id
    assert result.expiry_warnings[0].days_until == 2


def test_item_past_expiry_is_flagged_expired(monkeypatch) -> None:
    item = _item(expiry_date=date.today() - timedelta(days=1))
    result = _compute(monkeypatch, [item])

    assert len(result.expiry_warnings) == 1
    assert result.expiry_warnings[0].type == "EXPIRED"
    assert result.expiry_warnings[0].days_until == -1


def test_item_expiring_far_out_is_not_flagged(monkeypatch) -> None:
    item = _item(expiry_date=date.today() + timedelta(days=10))
    result = _compute(monkeypatch, [item])

    assert result.expiry_warnings == []


def test_item_with_no_dates_is_not_flagged(monkeypatch) -> None:
    item = _item()
    result = _compute(monkeypatch, [item])

    assert result.expiry_warnings == []


def test_non_active_item_is_not_flagged_even_if_expired(monkeypatch) -> None:
    item = _item(expiry_date=date.today() - timedelta(days=5), status="DISCARDED")
    result = _compute(monkeypatch, [item])

    assert result.expiry_warnings == []


def test_uses_earlier_of_expiry_and_best_by_date(monkeypatch) -> None:
    item = _item(
        expiry_date=date.today() + timedelta(days=10),
        best_by_date=date.today() + timedelta(days=1),
    )
    result = _compute(monkeypatch, [item])

    assert len(result.expiry_warnings) == 1
    assert result.expiry_warnings[0].relevant_date == date.today() + timedelta(days=1)


def test_zero_active_quantity_is_out_of_stock(monkeypatch) -> None:
    variant_id = uuid.uuid4()
    item = _item(variant_id=variant_id, quantity=Decimal("0"), status="EMPTY")
    result = _compute(monkeypatch, [item])

    assert len(result.stock_warnings) == 1
    assert result.stock_warnings[0].type == "OUT_OF_STOCK"
    assert result.stock_warnings[0].household_food_variant_id == variant_id


def test_remaining_below_20_percent_of_last_purchase_is_low_stock(monkeypatch) -> None:
    variant_id = uuid.uuid4()
    older = _item(
        variant_id=variant_id,
        quantity=Decimal("0"),
        total_quantity=Decimal("10"),
        status="EMPTY",
        purchased_at=datetime.now(UTC) - timedelta(days=10),
    )
    newest = _item(
        variant_id=variant_id,
        quantity=Decimal("1"),
        total_quantity=Decimal("10"),
        status="ACTIVE",
        purchased_at=datetime.now(UTC),
    )
    result = _compute(monkeypatch, [older, newest])

    assert len(result.stock_warnings) == 1
    assert result.stock_warnings[0].type == "LOW_STOCK"
    assert result.stock_warnings[0].remaining_quantity == Decimal("1")
    assert result.stock_warnings[0].reference_quantity == Decimal("10")


def test_healthy_remaining_quantity_is_not_flagged(monkeypatch) -> None:
    item = _item(quantity=Decimal("8"), total_quantity=Decimal("10"))
    result = _compute(monkeypatch, [item])

    assert result.stock_warnings == []


def test_multiple_active_items_for_same_variant_are_summed(monkeypatch) -> None:
    variant_id = uuid.uuid4()
    item_a = _item(variant_id=variant_id, quantity=Decimal("1"), total_quantity=Decimal("20"))
    item_b = _item(variant_id=variant_id, quantity=Decimal("1"), total_quantity=Decimal("20"))
    result = _compute(monkeypatch, [item_a, item_b])

    # 2 combined out of a 20-unit reference (20% cutoff = 4) is low stock.
    assert len(result.stock_warnings) == 1
    assert result.stock_warnings[0].remaining_quantity == Decimal("2")
