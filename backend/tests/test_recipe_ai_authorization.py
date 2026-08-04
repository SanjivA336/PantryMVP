import uuid

import pytest

from app.services.ai import AiOutputParsingError, AiProviderTimeoutError, AiProviderUnavailableError
from app.services.recipe_url_import import RecipeUrlFetchError
from tests.conftest import auth_header, make_member


def _draft_dict(**overrides) -> dict:
    body = {
        "name": "Pancakes",
        "description": None,
        "servings": 4,
        "prep_time_minutes": 10,
        "cook_time_minutes": 15,
        "instructions": ["Mix", "Cook"],
        "ingredients": [{"name": "flour", "quantity": "2", "unit": "cup", "note": None}],
        "source_url": None,
    }
    body.update(overrides)
    return body


@pytest.fixture
def fake_recipe_ai(monkeypatch):
    state = {"import": _draft_dict(), "generate": _draft_dict(), "raise": None}

    def import_recipe(household_id, body):
        if state["raise"]:
            raise state["raise"]
        return state["import"]

    def generate_recipe(household_id, params):
        if state["raise"]:
            raise state["raise"]
        return state["generate"]

    def suggest_substitutions(
        ingredient_name, ingredient_quantity, ingredient_unit, recipe_name, other_ingredient_names
    ):
        if state["raise"]:
            raise state["raise"]
        return [{"name": "almond milk", "quantity": "1", "unit": "cup", "note": "dairy-free"}]

    monkeypatch.setattr("app.services.recipe_ai.import_recipe", import_recipe)
    monkeypatch.setattr("app.services.recipe_ai.generate_recipe", generate_recipe)
    monkeypatch.setattr("app.services.recipe_ai.suggest_substitutions", suggest_substitutions)

    return state


async def test_non_member_cannot_import(client, fake_members, fake_recipe_ai) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/import",
        json={"source": "text", "text": "some recipe"},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_import_from_text(client, fake_members, fake_recipe_ai) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/import",
        json={"source": "text", "text": "some recipe"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["name"] == "Pancakes"


async def test_import_missing_text_for_text_source_is_422(
    client, fake_members, fake_recipe_ai
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/import",
        json={"source": "text"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 422


async def test_member_can_generate(client, fake_members, fake_recipe_ai) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/generate",
        json={"cuisines": ["Mexican"]},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"]["name"] == "Pancakes"


async def test_member_can_get_substitutions(client, fake_members, fake_recipe_ai) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/substitutions",
        json={"ingredient_name": "buttermilk"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200, response.text
    assert response.json()["data"][0]["name"] == "almond milk"


@pytest.mark.parametrize(
    ("exception", "expected_status"),
    [
        (RecipeUrlFetchError("bad url"), 400),
        (AiProviderUnavailableError("down"), 503),
        (AiProviderTimeoutError("slow"), 504),
        (AiOutputParsingError("garbage"), 502),
    ],
)
async def test_import_error_mapping(
    client, fake_members, fake_recipe_ai, exception, expected_status
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    fake_recipe_ai["raise"] = exception

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/import",
        json={"source": "text", "text": "some recipe"},
        headers=auth_header(user_id),
    )

    assert response.status_code == expected_status


@pytest.mark.parametrize(
    ("exception", "expected_status"),
    [
        (AiProviderUnavailableError("down"), 503),
        (AiProviderTimeoutError("slow"), 504),
        (AiOutputParsingError("garbage"), 502),
    ],
)
async def test_generate_error_mapping(
    client, fake_members, fake_recipe_ai, exception, expected_status
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    fake_recipe_ai["raise"] = exception

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/generate",
        json={},
        headers=auth_header(user_id),
    )

    assert response.status_code == expected_status


async def test_non_member_cannot_generate(client, fake_members, fake_recipe_ai) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/generate",
        json={},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_non_member_cannot_get_substitutions(client, fake_members, fake_recipe_ai) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/recipes/ai/substitutions",
        json={"ingredient_name": "milk"},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403
