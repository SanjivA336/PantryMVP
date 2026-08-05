import uuid
from decimal import Decimal

from app.services import recipes as recipe_service


class _FakeResult:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, data):
        self._data = data

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def in_(self, *_a, **_k):
        return self

    def execute(self):
        return _FakeResult(self._data)


class _FakeClient:
    def __init__(self, variants: list[dict], items: list[dict]):
        self._variants = variants
        self._items = items

    def table(self, name):
        if name == "household_food_variants":
            return _FakeQuery(self._variants)
        if name == "inventory_items":
            return _FakeQuery(self._items)
        raise AssertionError(f"unexpected table {name}")


def _ingredient_row(**overrides) -> dict:
    defaults = dict(
        id=str(uuid.uuid4()),
        global_food_definition_id=str(uuid.uuid4()),
        unit="g",
    )
    defaults.update(overrides)
    return defaults


def test_nothing_on_hand_is_unavailable(monkeypatch) -> None:
    ingredient = _ingredient_row()
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=[], items=[])
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is False
    assert quantity is None


def test_exact_unit_match_reports_available_quantity(monkeypatch) -> None:
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(unit="g")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    items = [
        {"household_food_variant_id": variant_id, "quantity": "200", "preferred_unit": "g"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    assert quantity == Decimal("200")


def test_same_dimension_different_unit_converts(monkeypatch) -> None:
    """Regression case for the unit-conversion feature: on-hand stock in
    ounces should now resolve to a real quantity for a recipe asking for
    grams, instead of the old exact-string-match-only binary behavior."""
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(unit="g")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    items = [
        {"household_food_variant_id": variant_id, "quantity": "1", "preferred_unit": "oz"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    assert quantity == Decimal("28.3495")


def test_cross_dimension_mismatch_falls_back_to_binary(monkeypatch) -> None:
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(unit="cup")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    items = [
        {"household_food_variant_id": variant_id, "quantity": "200", "preferred_unit": "g"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    assert quantity is None


def test_multiple_on_hand_units_are_combined_via_conversion(monkeypatch) -> None:
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(unit="g")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    items = [
        {"household_food_variant_id": variant_id, "quantity": "100", "preferred_unit": "g"},
        {"household_food_variant_id": variant_id, "quantity": "1", "preferred_unit": "kg"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    assert quantity == Decimal("1100")
