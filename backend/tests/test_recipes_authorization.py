import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.schemas.recipe import Recipe, RecipeDetail, RecipeIngredient
from app.services import recipes as recipe_service
from tests.conftest import auth_header, make_member


def _recipe(user_id: uuid.UUID, **overrides) -> Recipe:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        created_by_user_id=user_id,
        name="Pancakes",
        description=None,
        servings=4,
        prep_time_minutes=10,
        cook_time_minutes=15,
        instructions=["Mix", "Cook"],
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return Recipe(**defaults)


def _ingredient(**overrides) -> RecipeIngredient:
    defaults = dict(
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
        available_quantity=Decimal("5"),
    )
    defaults.update(overrides)
    return RecipeIngredient(**defaults)


def _detail(user_id: uuid.UUID, **overrides) -> RecipeDetail:
    recipe = _recipe(user_id, **{k: v for k, v in overrides.items() if k != "ingredients"})
    ingredients = overrides.get("ingredients", [_ingredient(recipe_id=recipe.id)])
    return RecipeDetail(**recipe.model_dump(), ingredients=ingredients)


@pytest.fixture
def fake_recipes(monkeypatch):
    store: dict[uuid.UUID, RecipeDetail] = {}

    def list_recipes(user_id):
        return [
            Recipe(**{k: v for k, v in r.model_dump().items() if k != "ingredients"})
            for r in store.values()
            if r.created_by_user_id == user_id
        ]

    def get_recipe(household_id, user_id, recipe_id):
        recipe = store.get(recipe_id)
        return recipe if recipe and recipe.created_by_user_id == user_id else None

    def create_recipe(household_id, user_id, body):
        detail = _detail(
            user_id,
            name=body.name,
            description=body.description,
            servings=body.servings,
            prep_time_minutes=body.prep_time_minutes,
            cook_time_minutes=body.cook_time_minutes,
            instructions=body.instructions,
        )
        store[detail.id] = detail
        return detail

    def update_recipe(household_id, user_id, recipe_id, body):
        existing = store.get(recipe_id)
        if existing is None or existing.created_by_user_id != user_id:
            raise recipe_service.RecipeNotFoundError
        updated = existing.model_copy(update={"name": body.name, "servings": body.servings})
        store[recipe_id] = updated
        return updated

    def delete_recipe(user_id, recipe_id):
        existing = store.get(recipe_id)
        if existing and existing.created_by_user_id == user_id:
            store.pop(recipe_id, None)
            return True
        return False

    monkeypatch.setattr("app.services.recipes.list_recipes", list_recipes)
    monkeypatch.setattr("app.services.recipes.get_recipe", get_recipe)
    monkeypatch.setattr("app.services.recipes.create_recipe", create_recipe)
    monkeypatch.setattr("app.services.recipes.update_recipe", update_recipe)
    monkeypatch.setattr("app.services.recipes.delete_recipe", delete_recipe)

    return store


def _create_body(**overrides) -> dict:
    body = {
        "name": "Pancakes",
        "servings": 4,
        "prep_time_minutes": 10,
        "cook_time_minutes": 15,
        "instructions": ["Mix", "Cook"],
        "ingredients": [
            {"global_food_definition_id": str(uuid.uuid4()), "quantity": "2", "unit": "cup"}
        ],
    }
    body.update(overrides)
    return body


async def test_non_member_cannot_list_recipes(client, fake_members, fake_recipes) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.get(
        f"/api/households/{household_id}/recipes",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_create_and_list_recipes(client, fake_members, fake_recipes) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    create_resp = await client.post(
        f"/api/households/{household_id}/recipes",
        json=_create_body(),
        headers=auth_header(user_id),
    )
    assert create_resp.status_code == 201, create_resp.text
    assert create_resp.json()["data"]["name"] == "Pancakes"
    assert len(create_resp.json()["data"]["ingredients"]) == 1

    list_resp = await client.get(
        f"/api/households/{household_id}/recipes",
        headers=auth_header(user_id),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()["data"]) == 1


async def test_get_nonexistent_recipe_returns_404(client, fake_members, fake_recipes) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.get(
        f"/api/households/{household_id}/recipes/{uuid.uuid4()}",
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_member_can_update_recipe(client, fake_members, fake_recipes) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    detail = _detail(user_id)
    fake_recipes[detail.id] = detail

    response = await client.patch(
        f"/api/households/{household_id}/recipes/{detail.id}",
        json=_create_body(name="Waffles", servings=6),
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["name"] == "Waffles"


async def test_updating_nonexistent_recipe_returns_404(client, fake_members, fake_recipes) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.patch(
        f"/api/households/{household_id}/recipes/{uuid.uuid4()}",
        json=_create_body(),
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_member_can_delete_recipe(client, fake_members, fake_recipes) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    detail = _detail(user_id)
    fake_recipes[detail.id] = detail

    response = await client.delete(
        f"/api/households/{household_id}/recipes/{detail.id}",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert detail.id not in fake_recipes


async def test_other_household_member_cannot_see_or_edit_recipe(
    client, fake_members, fake_recipes
) -> None:
    """The core behavior change of the per-user recipe model: being in the
    same household is no longer enough to see someone else's recipe."""
    household_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    roommate_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, owner_id))
    fake_members.seed(make_member(household_id, roommate_id))
    detail = _detail(owner_id)
    fake_recipes[detail.id] = detail

    get_resp = await client.get(
        f"/api/households/{household_id}/recipes/{detail.id}",
        headers=auth_header(roommate_id),
    )
    assert get_resp.status_code == 404

    list_resp = await client.get(
        f"/api/households/{household_id}/recipes",
        headers=auth_header(roommate_id),
    )
    assert list_resp.json()["data"] == []

    delete_resp = await client.delete(
        f"/api/households/{household_id}/recipes/{detail.id}",
        headers=auth_header(roommate_id),
    )
    assert delete_resp.status_code == 404
    assert detail.id in fake_recipes
