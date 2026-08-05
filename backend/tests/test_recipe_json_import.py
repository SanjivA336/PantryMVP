import uuid

import pytest

from app.schemas.recipe_ai import ImportRecipeRequest
from app.services import recipe_ai as recipe_ai_service
from tests.conftest import auth_header, make_member


def _export_payload(**overrides) -> dict:
    body = {
        "name": "Pancakes",
        "description": "Fluffy",
        "servings": 4,
        "prep_time_minutes": 10,
        "cook_time_minutes": 15,
        "instructions": ["Mix", "Cook"],
        "ingredients": [
            {
                "name": "Flour",
                "quantity": "2",
                "unit": "cup",
                "note": None,
                # A previously-resolved id from whoever exported this --
                # must never be trusted directly on import (see
                # test_draft_from_json_strips_foreign_ingredient_ids).
                "global_food_definition_id": str(uuid.uuid4()),
            }
        ],
    }
    body.update(overrides)
    return body


def test_draft_from_json_strips_foreign_ingredient_ids() -> None:
    draft = recipe_ai_service._draft_from_json(_export_payload())

    assert draft.name == "Pancakes"
    assert draft.ingredients[0].name == "Flour"
    assert draft.ingredients[0].global_food_definition_id is None


def test_draft_from_json_rejects_malformed_input() -> None:
    with pytest.raises(recipe_ai_service.RecipeShareParsingError):
        recipe_ai_service._draft_from_json({"not": "a recipe"})


def test_import_recipe_json_source_never_calls_ai_provider(monkeypatch) -> None:
    calls: list[str] = []
    monkeypatch.setattr(
        "app.services.recipe_ai.get_ai_provider",
        lambda: calls.append("ai"),
    )
    monkeypatch.setattr(
        "app.services.recipe_ai._resolve_ingredient_food_ids", lambda hh, draft: None
    )

    body = ImportRecipeRequest(source="json", json_data=_export_payload())
    draft = recipe_ai_service.import_recipe(uuid.uuid4(), body)

    assert draft.name == "Pancakes"
    assert calls == []


def test_import_request_requires_json_data_for_json_source() -> None:
    with pytest.raises(ValueError):
        ImportRecipeRequest(source="json")


async def test_import_json_with_malformed_data_returns_400(client, fake_members) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/import",
        json={"source": "json", "json_data": {"not": "a recipe"}},
        headers=auth_header(user_id),
    )

    assert response.status_code == 400


async def test_import_json_with_valid_export_returns_draft(
    client, fake_members, monkeypatch
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    monkeypatch.setattr(
        "app.services.recipe_ai._resolve_ingredient_food_ids", lambda hh, draft: None
    )

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/import",
        json={"source": "json", "json_data": _export_payload()},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["name"] == "Pancakes"
    assert data["ingredients"][0]["global_food_definition_id"] is None
