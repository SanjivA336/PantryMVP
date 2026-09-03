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
    # quantity is a base value now (migration 0028); display_unit only
    # decides the dimension and how it's shown.
    defaults = dict(
        id=str(uuid.uuid4()),
        global_food_definition_id=str(uuid.uuid4()),
        quantity="100",
        display_unit="g",
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


def test_same_dimension_stock_reports_available_quantity(monkeypatch) -> None:
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(display_unit="g")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    # 200 base grams on hand, however it happens to be displayed.
    items = [
        {"household_food_variant_id": variant_id, "quantity": "200", "display_unit": "oz"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    # Returned in the ingredient's own display unit (g here -> 1:1 with base).
    assert quantity == Decimal("200")


def test_available_quantity_is_expressed_in_the_ingredients_unit(monkeypatch) -> None:
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(display_unit="kg")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    items = [
        {"household_food_variant_id": variant_id, "quantity": "1500", "display_unit": "g"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    # 1500 base grams shown to a recipe asking in kg.
    assert quantity == Decimal("1.5")


def test_cross_dimension_mismatch_falls_back_to_binary(monkeypatch) -> None:
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(display_unit="cup")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    items = [
        {"household_food_variant_id": variant_id, "quantity": "200", "display_unit": "g"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    assert quantity is None


def test_multiple_active_items_sum_in_base(monkeypatch) -> None:
    variant_id = str(uuid.uuid4())
    ingredient = _ingredient_row(display_unit="g")
    variants = [
        {"id": variant_id, "global_food_definition_id": ingredient["global_food_definition_id"]}
    ]
    items = [
        {"household_food_variant_id": variant_id, "quantity": "100", "display_unit": "g"},
        {"household_food_variant_id": variant_id, "quantity": "1000", "display_unit": "kg"},
    ]
    monkeypatch.setattr(
        recipe_service, "get_service_client", lambda: _FakeClient(variants=variants, items=items)
    )

    result = recipe_service._ingredient_availability(uuid.uuid4(), [ingredient])

    available, quantity = result[uuid.UUID(ingredient["id"])]
    assert available is True
    assert quantity == Decimal("1100")
