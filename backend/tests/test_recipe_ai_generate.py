import uuid
from datetime import UTC, datetime
from decimal import Decimal

from app.schemas.inventory_item import InventoryItem
from app.schemas.recipe_ai import DraftRecipe, GenerateRecipeParams
from app.services import recipe_ai as recipe_ai_service


def _draft() -> DraftRecipe:
    return DraftRecipe(
        name="Pancakes",
        instructions=["Mix", "Cook"],
        ingredients=[{"name": "flour", "quantity": "2", "unit": "cup", "note": None}],
    )


def _item(food_name: str) -> InventoryItem:
    now = datetime.now(UTC)
    return InventoryItem(
        id=uuid.uuid4(),
        household_id=uuid.uuid4(),
        household_food_variant_id=uuid.uuid4(),
        storage_location_id=uuid.uuid4(),
        purchase_event_id=uuid.uuid4(),
        quantity=Decimal("1"),
        total_quantity=Decimal("1"),
        preferred_unit="count",
        cost=Decimal("0"),
        purchased_at=now,
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
        food_name=food_name,
        food_type_name=food_name,
        category=None,
        name_override=None,
        storage_location_name="Fridge",
    )


def test_pantry_only_populates_available_ingredients_from_active_inventory(monkeypatch) -> None:
    items = [_item("Eggs"), _item("Milk"), _item("Eggs")]  # duplicate name, dedup expected
    monkeypatch.setattr(
        "app.services.recipe_ai.inventory_service.list_for_household", lambda hh, status: items
    )
    captured: dict = {}

    class FakeProvider:
        def generate_recipe(self, params: GenerateRecipeParams) -> DraftRecipe:
            captured["params"] = params
            return _draft()

    monkeypatch.setattr("app.services.recipe_ai.get_ai_provider", lambda: FakeProvider())
    monkeypatch.setattr(
        "app.services.recipe_ai._resolve_ingredient_food_ids", lambda hh, draft: None
    )

    recipe_ai_service.generate_recipe(uuid.uuid4(), GenerateRecipeParams(pantry_only=True))

    assert captured["params"].available_ingredients == ["Eggs", "Milk"]


def test_pantry_only_false_leaves_available_ingredients_empty(monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.recipe_ai.inventory_service.list_for_household",
        lambda hh, status: (_ for _ in ()).throw(AssertionError("should not fetch inventory")),
    )
    captured: dict = {}

    class FakeProvider:
        def generate_recipe(self, params: GenerateRecipeParams) -> DraftRecipe:
            captured["params"] = params
            return _draft()

    monkeypatch.setattr("app.services.recipe_ai.get_ai_provider", lambda: FakeProvider())
    monkeypatch.setattr(
        "app.services.recipe_ai._resolve_ingredient_food_ids", lambda hh, draft: None
    )

    recipe_ai_service.generate_recipe(uuid.uuid4(), GenerateRecipeParams(pantry_only=False))

    assert captured["params"].available_ingredients == []
