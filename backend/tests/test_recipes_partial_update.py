import uuid
from decimal import Decimal

import pytest

from app.schemas.recipe import UpdateRecipeRequest
from app.services import recipes as recipe_service


def _existing(**recipe_overrides) -> tuple[dict, list[dict]]:
    recipe_row = {
        "id": str(uuid.uuid4()),
        "name": "Pancakes",
        "description": "Fluffy",
        "servings": 4,
        "prep_time_minutes": 10,
        "cook_time_minutes": 15,
        "instructions": ["Mix", "Cook"],
    }
    recipe_row.update(recipe_overrides)
    ingredient_row = {
        "global_food_definition_id": uuid.uuid4(),
        # A stored row: quantity in base units, unit as `display_unit`.
        "quantity": Decimal("473.176"),
        "display_unit": "cup",
        "note": None,
    }
    return recipe_row, [ingredient_row]


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
    # update_recipe's own final re-fetch (its return value, not asserted on
    # by these tests) -- distinct from the pre-update defaulting fetch each
    # test monkeypatches individually via _fetch_recipe_and_ingredients.
    monkeypatch.setattr(recipe_service, "get_recipe", lambda hh, uid, rid: None)
    return calls


def test_partial_update_of_name_only_preserves_everything_else(monkeypatch, rpc_calls) -> None:
    existing_row, existing_ingredients = _existing(
        name="Pancakes", servings=4, description="Fluffy"
    )
    monkeypatch.setattr(
        recipe_service,
        "_fetch_recipe_and_ingredients",
        lambda uid, rid: (existing_row, existing_ingredients),
    )

    recipe_service.update_recipe(
        uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), UpdateRecipeRequest(name="Waffles")
    )

    assert len(rpc_calls) == 1
    _, params = rpc_calls[0]
    assert params["p_name"] == "Waffles"
    assert params["p_description"] == "Fluffy"
    assert params["p_servings"] == 4
    assert params["p_prep_time_minutes"] == 10
    assert params["p_cook_time_minutes"] == 15
    assert params["p_instructions"] == ["Mix", "Cook"]
    assert len(params["p_ingredients"]) == 1
    assert params["p_ingredients"][0]["global_food_definition_id"] == str(
        existing_ingredients[0]["global_food_definition_id"]
    )


def test_description_explicitly_cleared_is_respected(monkeypatch, rpc_calls) -> None:
    existing_row, existing_ingredients = _existing(description="Fluffy")
    monkeypatch.setattr(
        recipe_service,
        "_fetch_recipe_and_ingredients",
        lambda uid, rid: (existing_row, existing_ingredients),
    )
    # Passing description=None to the constructor -- even though None is
    # also the field's default -- still marks it in model_fields_set. That's
    # what makes this a genuine "clear the description" request, distinct
    # from the first test above where description is never mentioned at all.
    body = UpdateRecipeRequest(description=None)
    assert "description" in body.model_fields_set

    recipe_service.update_recipe(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), body)

    _, params = rpc_calls[0]
    assert params["p_description"] is None


def test_updating_ingredients_replaces_the_full_list(monkeypatch, rpc_calls) -> None:
    existing_row, existing_ingredients = _existing()
    monkeypatch.setattr(
        recipe_service,
        "_fetch_recipe_and_ingredients",
        lambda uid, rid: (existing_row, existing_ingredients),
    )
    new_food_id = uuid.uuid4()

    recipe_service.update_recipe(
        uuid.uuid4(),
        uuid.uuid4(),
        uuid.uuid4(),
        UpdateRecipeRequest(
            ingredients=[{"global_food_definition_id": new_food_id, "quantity": "1", "unit": "cup"}]
        ),
    )

    _, params = rpc_calls[0]
    assert len(params["p_ingredients"]) == 1
    assert params["p_ingredients"][0]["global_food_definition_id"] == str(new_food_id)


def test_updating_nonexistent_recipe_raises_before_any_rpc_call(monkeypatch, rpc_calls) -> None:
    monkeypatch.setattr(recipe_service, "_fetch_recipe_and_ingredients", lambda uid, rid: None)

    with pytest.raises(recipe_service.RecipeNotFoundError):
        recipe_service.update_recipe(
            uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), UpdateRecipeRequest(name="X")
        )

    assert rpc_calls == []
