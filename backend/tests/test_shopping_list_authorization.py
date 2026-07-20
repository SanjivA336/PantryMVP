import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.shopping_list import ShoppingListItem, ShoppingListItemStatus, ShoppingListSection
from tests.conftest import auth_header, make_member


def _section(household_id: uuid.UUID, **overrides) -> ShoppingListSection:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(), household_id=household_id, name="Produce", created_at=now, updated_at=now
    )
    defaults.update(overrides)
    return ShoppingListSection(**defaults)


def _item(household_id: uuid.UUID, **overrides) -> ShoppingListItem:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        section_id=None,
        name="Napkins",
        household_food_variant_id=None,
        source="MANUAL",
        status="ACTIVE",
        added_by_member_id=uuid.uuid4(),
        removed_at=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return ShoppingListItem(**defaults)


@pytest.fixture
def fake_shopping_list(monkeypatch):
    sections: dict[uuid.UUID, ShoppingListSection] = {}
    items: dict[uuid.UUID, ShoppingListItem] = {}

    def list_sections(household_id):
        return [s for s in sections.values() if s.household_id == household_id]

    def create_section(household_id, name):
        section = _section(household_id, name=name)
        sections[section.id] = section
        return section

    def delete_section(household_id, section_id):
        sections.pop(section_id, None)

    def list_items(household_id, status="ACTIVE"):
        result = [i for i in items.values() if i.household_id == household_id]
        if status:
            result = [i for i in result if i.status == status]
        return result

    def create_manual_item(household_id, member_id, body):
        item = _item(
            household_id, name=body.name, section_id=body.section_id, added_by_member_id=member_id
        )
        items[item.id] = item
        return item

    def remove_item(household_id, item_id):
        item = items.get(item_id)
        if item is None or item.household_id != household_id or item.status != "ACTIVE":
            raise ValueError("Item not found or not currently active")
        updated = item.model_copy(
            update={"status": ShoppingListItemStatus.REMOVED, "removed_at": datetime.now(UTC)}
        )
        items[item_id] = updated
        return updated

    def suggest_items(household_id, member_id):
        return []

    monkeypatch.setattr("app.services.shopping_list.list_sections", list_sections)
    monkeypatch.setattr("app.services.shopping_list.create_section", create_section)
    monkeypatch.setattr("app.services.shopping_list.delete_section", delete_section)
    monkeypatch.setattr("app.services.shopping_list.list_items", list_items)
    monkeypatch.setattr("app.services.shopping_list.create_manual_item", create_manual_item)
    monkeypatch.setattr("app.services.shopping_list.remove_item", remove_item)
    monkeypatch.setattr("app.services.shopping_list.suggest_items", suggest_items)

    return {"sections": sections, "items": items}


async def test_non_member_cannot_list_sections(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.get(
        f"/api/households/{household_id}/shopping-list/sections",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_create_and_list_sections(
    client, fake_members, fake_shopping_list
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    create_resp = await client.post(
        f"/api/households/{household_id}/shopping-list/sections",
        json={"name": "Produce"},
        headers=auth_header(user_id),
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["data"]["name"] == "Produce"

    list_resp = await client.get(
        f"/api/households/{household_id}/shopping-list/sections",
        headers=auth_header(user_id),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()["data"]) == 1


async def test_member_can_delete_section(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    section = _section(household_id)
    fake_shopping_list["sections"][section.id] = section

    response = await client.delete(
        f"/api/households/{household_id}/shopping-list/sections/{section.id}",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200


async def test_non_member_cannot_create_item(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/shopping-list/items",
        json={"name": "Napkins"},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_create_and_list_items(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    create_resp = await client.post(
        f"/api/households/{household_id}/shopping-list/items",
        json={"name": "Napkins"},
        headers=auth_header(user_id),
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["data"]["source"] == "MANUAL"

    list_resp = await client.get(
        f"/api/households/{household_id}/shopping-list/items",
        headers=auth_header(user_id),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()["data"]) == 1


async def test_removing_nonexistent_item_returns_404(
    client, fake_members, fake_shopping_list
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.delete(
        f"/api/households/{household_id}/shopping-list/items/{uuid.uuid4()}",
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_removing_active_item_succeeds_and_disappears_from_active_list(
    client, fake_members, fake_shopping_list
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id)
    fake_shopping_list["items"][item.id] = item

    remove_resp = await client.delete(
        f"/api/households/{household_id}/shopping-list/items/{item.id}",
        headers=auth_header(user_id),
    )
    assert remove_resp.status_code == 200
    assert remove_resp.json()["data"]["status"] == "REMOVED"

    list_resp = await client.get(
        f"/api/households/{household_id}/shopping-list/items",
        headers=auth_header(user_id),
    )
    assert list_resp.json()["data"] == []


async def test_non_member_cannot_suggest(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/shopping-list/suggest",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_trigger_suggest(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/shopping-list/suggest",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"] == []
