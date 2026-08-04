import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schemas.recipe import RecipeDetail, RecipeIngredient, UpdateRecipeRequest
from app.services import recipes as recipe_service


def _detail(**overrides) -> RecipeDetail:
    now = datetime.now(UTC)
    ingredient = RecipeIngredient(
        id=uuid.uuid4(),
        recipe_id=uuid.uuid4(),
        global_food_definition_id=uuid.uuid4(),
        food_name="Flour",
        category="GRAINS_BREADS",
        quantity=Decimal("2"),
        unit="cup",
        note=None,
        position=0,
        available=True,
        available_quantity=None,
    )
    defaults = dict(
        id=uuid.uuid4(),
        household_id=uuid.uuid4(),
        created_by_member_id=uuid.uuid4(),
        name="Pancakes",
        description="Fluffy",
        servings=4,
        prep_time_minutes=10,
        cook_time_minutes=15,
        instructions=["Mix", "Cook"],
        created_at=now,
        updated_at=now,
        ingredients=[ingredient],
    )
    defaults.update(overrides)
    return RecipeDetail(**defaults)


class _FakeResult:
    data = None


class _FakeRpcQuery:
    def __init__(self, calls, name, params):
        self._calls = calls
        self._name = name
        self._params = params

    def execute(self):
        self._calls.append((self._name, self._params))
        return _FakeResult()


class _FakeClient:
    def __init__(self, calls):
        self._calls = calls

    def rpc(self, name, params):
        return _FakeRpcQuery(self._calls, name, params)


@pytest.fixture
def rpc_calls(monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setattr(recipe_service, "get_service_client", lambda: _FakeClient(calls))
    return calls


def test_partial_update_of_name_only_preserves_everything_else(monkeypatch, rpc_calls) -> None:
    existing = _detail(name="Pancakes", servings=4, description="Fluffy")
    monkeypatch.setattr(recipe_service, "get_recipe", lambda hh, rid: existing)

    recipe_service.update_recipe(uuid.uuid4(), existing.id, UpdateRecipeRequest(name="Waffles"))

    assert len(rpc_calls) == 1
    _, params = rpc_calls[0]
    assert params["p_name"] == "Waffles"
    assert params["p_description"] == "Fluffy"
    assert params["p_servings"] == 4
    assert params["p_prep_time_minutes"] == existing.prep_time_minutes
    assert params["p_cook_time_minutes"] == existing.cook_time_minutes
    assert params["p_instructions"] == existing.instructions
    assert len(params["p_ingredients"]) == 1
    assert params["p_ingredients"][0]["global_food_definition_id"] == str(
        existing.ingredients[0].global_food_definition_id
    )


def test_description_explicitly_cleared_is_respected(monkeypatch, rpc_calls) -> None:
    existing = _detail(description="Fluffy")
    monkeypatch.setattr(recipe_service, "get_recipe", lambda hh, rid: existing)
    # Passing description=None to the constructor -- even though None is
    # also the field's default -- still marks it in model_fields_set. That's
    # what makes this a genuine "clear the description" request, distinct
    # from the first test above where description is never mentioned at all.
    body = UpdateRecipeRequest(description=None)
    assert "description" in body.model_fields_set

    recipe_service.update_recipe(uuid.uuid4(), existing.id, body)

    _, params = rpc_calls[0]
    assert params["p_description"] is None


def test_updating_ingredients_replaces_the_full_list(monkeypatch, rpc_calls) -> None:
    existing = _detail()
    monkeypatch.setattr(recipe_service, "get_recipe", lambda hh, rid: existing)
    new_food_id = uuid.uuid4()

    recipe_service.update_recipe(
        uuid.uuid4(),
        existing.id,
        UpdateRecipeRequest(
            ingredients=[
                {"global_food_definition_id": new_food_id, "quantity": "1", "unit": "cup"}
            ]
        ),
    )

    _, params = rpc_calls[0]
    assert len(params["p_ingredients"]) == 1
    assert params["p_ingredients"][0]["global_food_definition_id"] == str(new_food_id)


def test_updating_nonexistent_recipe_raises_before_any_rpc_call(monkeypatch, rpc_calls) -> None:
    monkeypatch.setattr(recipe_service, "get_recipe", lambda hh, rid: None)

    with pytest.raises(recipe_service.RecipeNotFoundError):
        recipe_service.update_recipe(uuid.uuid4(), uuid.uuid4(), UpdateRecipeRequest(name="X"))

    assert rpc_calls == []
