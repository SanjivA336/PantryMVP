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
        debt_frozen_at=None,
        created_at=now,
        updated_at=now,
        food_name="Whole Milk",
        food_type_name="Whole Milk",
        category="DAIRY_ALTERNATIVES",
        name_override=None,
        storage_location_name="Test Fridge",
        allowed_member_ids=[],
    )
    defaults.update(overrides)
    return InventoryItem(**defaults)


def _compute(monkeypatch, items, *, ignored_expiry_ids=frozenset(), ignored_stock=None):
    monkeypatch.setattr(
        "app.services.warnings.inventory_service.list_for_household", lambda hh: items
    )
    monkeypatch.setattr(
        "app.services.warnings._fetch_ignored_expiry_item_ids", lambda hh: set(ignored_expiry_ids)
    )
    monkeypatch.setattr(
        "app.services.warnings._fetch_ignored_stock_references", lambda hh: ignored_stock or {}
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


def test_ignored_expiry_warning_is_suppressed(monkeypatch) -> None:
    item = _item(expiry_date=date.today() - timedelta(days=1))
    result = _compute(monkeypatch, [item], ignored_expiry_ids={item.id})

    assert result.expiry_warnings == []


def test_ignored_stock_warning_is_suppressed_only_for_same_reference_purchase(
    monkeypatch,
) -> None:
    variant_id = uuid.uuid4()
    item = _item(variant_id=variant_id, quantity=Decimal("0"), status="EMPTY")

    suppressed = _compute(
        monkeypatch, [item], ignored_stock={(variant_id, "count"): item.purchased_at}
    )
    assert suppressed.stock_warnings == []

    # A different reference_purchased_at (e.g. a newer purchase happened
    # since the ignore was recorded) means the old ignore no longer applies.
    still_shown = _compute(
        monkeypatch,
        [item],
        ignored_stock={(variant_id, "count"): item.purchased_at - timedelta(days=1)},
    )
    assert len(still_shown.stock_warnings) == 1


def test_stock_split_across_dimensions_produces_separate_stock_lines(monkeypatch) -> None:
    variant_id = uuid.uuid4()
    weight_item = _item(
        variant_id=variant_id,
        quantity=Decimal("0"),
        total_quantity=Decimal("500"),
        preferred_unit="g",
        status="EMPTY",
    )
    volume_item = _item(
        variant_id=variant_id,
        quantity=Decimal("1"),
        total_quantity=Decimal("10"),
        preferred_unit="cup",
        status="ACTIVE",
    )
    result = _compute(monkeypatch, [weight_item, volume_item])

    # Same variant, but weight and volume can't be merged without a density
    # this app never asks for -- each dimension gets its own warning line
    # instead of one incorrectly-combined total.
    assert len(result.stock_warnings) == 2
    types_by_unit = {w.preferred_unit: w.type for w in result.stock_warnings}
    assert types_by_unit["g"] == "OUT_OF_STOCK"
    assert types_by_unit["cup"] == "LOW_STOCK"


def test_multiple_active_items_in_convertible_units_are_summed_correctly(monkeypatch) -> None:
    variant_id = uuid.uuid4()
    older_in_kg = _item(
        variant_id=variant_id,
        quantity=Decimal("1"),
        total_quantity=Decimal("1"),
        preferred_unit="kg",
        purchased_at=datetime.now(UTC) - timedelta(days=5),
    )
    newest_in_g = _item(
        variant_id=variant_id,
        quantity=Decimal("0"),
        total_quantity=Decimal("1000"),
        preferred_unit="g",
        status="EMPTY",
        purchased_at=datetime.now(UTC),
    )
    result = _compute(monkeypatch, [older_in_kg, newest_in_g])

    # 1kg on hand converts to 1000g against a 1000g reference -- healthy,
    # not low stock. Summing the raw "1" against the "1000" reference
    # without converting units first would wrongly flag this as critically
    # low.
    assert result.stock_warnings == []
