import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.shopping_list import ShoppingListItem, ShoppingListItemStatus, ShoppingListSection
from tests.conftest import auth_header, make_member


def _section(household_id: uuid.UUID, **overrides) -> ShoppingListSection:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        name="Produce",
        sort_order=0,
        created_at=now,
        updated_at=now,
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
        collected=False,
        sort_order=0,
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
    ignored: set[tuple[uuid.UUID, uuid.UUID]] = set()

    def list_sections(household_id):
        return [s for s in sections.values() if s.household_id == household_id]

    def create_section(household_id, name):
        section = _section(household_id, name=name)
        sections[section.id] = section
        return section

    def update_section(household_id, section_id, updates):
        section = sections.get(section_id)
        if section is None or section.household_id != household_id:
            return None
        updated = section.model_copy(update=updates)
        sections[section_id] = updated
        return updated

    def delete_section(household_id, section_id):
        return sections.pop(section_id, None) is not None

    def list_items(household_id, status="ACTIVE"):
        result = [i for i in items.values() if i.household_id == household_id]
        if status:
            result = [i for i in result if i.status == status]
        return result

    def create_manual_item(household_id, member_id, body):
        item = _item(
            household_id,
            name="Fake Food",
            household_food_variant_id=uuid.uuid4(),
            section_id=body.section_id,
            added_by_member_id=member_id,
        )
        items[item.id] = item
        return item

    def update_item(household_id, item_id, updates):
        item = items.get(item_id)
        if item is None or item.household_id != household_id:
            return None
        updated = item.model_copy(update=updates)
        items[item_id] = updated
        return updated

    def remove_item(household_id, item_id):
        item = items.get(item_id)
        if item is None or item.household_id != household_id or item.status != "ACTIVE":
            raise ValueError("Item not found or not currently active")
        updated = item.model_copy(
            update={"status": ShoppingListItemStatus.REMOVED, "removed_at": datetime.now(UTC)}
        )
        items[item_id] = updated
        return updated

    def clear_items(household_id):
        for item_id, item in list(items.items()):
            if item.household_id == household_id and item.status == "ACTIVE":
                items[item_id] = item.model_copy(
                    update={
                        "status": ShoppingListItemStatus.REMOVED,
                        "removed_at": datetime.now(UTC),
                    }
                )

    def ignore_variant_permanently(household_id, household_food_variant_id):
        ignored.add((household_id, household_food_variant_id))

    def suggest_items(household_id, member_id):
        return []

    monkeypatch.setattr("app.services.shopping_list.list_sections", list_sections)
    monkeypatch.setattr("app.services.shopping_list.create_section", create_section)
    monkeypatch.setattr("app.services.shopping_list.update_section", update_section)
    monkeypatch.setattr("app.services.shopping_list.delete_section", delete_section)
    monkeypatch.setattr("app.services.shopping_list.list_items", list_items)
    monkeypatch.setattr("app.services.shopping_list.create_manual_item", create_manual_item)
    monkeypatch.setattr("app.services.shopping_list.update_item", update_item)
    monkeypatch.setattr("app.services.shopping_list.remove_item", remove_item)
    monkeypatch.setattr("app.services.shopping_list.clear_items", clear_items)
    monkeypatch.setattr(
        "app.services.shopping_list.ignore_variant_permanently", ignore_variant_permanently
    )
    monkeypatch.setattr("app.services.shopping_list.suggest_items", suggest_items)

    return {"sections": sections, "items": items, "ignored": ignored}


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


async def test_member_can_reorder_section(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    section = _section(household_id, sort_order=0)
    fake_shopping_list["sections"][section.id] = section

    response = await client.patch(
        f"/api/households/{household_id}/shopping-list/sections/{section.id}",
        json={"sort_order": 5},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["sort_order"] == 5


async def test_member_can_rename_section(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    section = _section(household_id, name="Produce")
    fake_shopping_list["sections"][section.id] = section

    response = await client.patch(
        f"/api/households/{household_id}/shopping-list/sections/{section.id}",
        json={"name": "Frozen"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["name"] == "Frozen"


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
        json={"global_food_definition_id": str(uuid.uuid4())},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_create_and_list_items(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    create_resp = await client.post(
        f"/api/households/{household_id}/shopping-list/items",
        json={"global_food_definition_id": str(uuid.uuid4())},
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


async def test_member_can_mark_item_collected(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id)
    fake_shopping_list["items"][item.id] = item

    response = await client.patch(
        f"/api/households/{household_id}/shopping-list/items/{item.id}",
        json={"collected": True},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["collected"] is True


async def test_updating_nonexistent_item_returns_404(
    client, fake_members, fake_shopping_list
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.patch(
        f"/api/households/{household_id}/shopping-list/items/{uuid.uuid4()}",
        json={"collected": True},
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_member_can_ignore_variant_permanently(
    client, fake_members, fake_shopping_list
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    variant_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/shopping-list/ignored-variants",
        json={"household_food_variant_id": str(variant_id)},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert (household_id, variant_id) in fake_shopping_list["ignored"]


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


async def test_non_member_cannot_clear_list(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/shopping-list/clear",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_clear_list(client, fake_members, fake_shopping_list) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item_a = _item(household_id, name="Napkins")
    item_b = _item(household_id, name="Bread")
    fake_shopping_list["items"][item_a.id] = item_a
    fake_shopping_list["items"][item_b.id] = item_b

    response = await client.post(
        f"/api/households/{household_id}/shopping-list/clear",
        headers=auth_header(user_id),
    )
    assert response.status_code == 200

    list_resp = await client.get(
        f"/api/households/{household_id}/shopping-list/items",
        headers=auth_header(user_id),
    )
    assert list_resp.json()["data"] == []


async def test_clear_list_does_not_affect_other_households(
    client, fake_members, fake_shopping_list
) -> None:
    household_id = uuid.uuid4()
    other_household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    fake_members.seed(make_member(other_household_id, user_id))
    other_item = _item(other_household_id, name="Eggs")
    fake_shopping_list["items"][other_item.id] = other_item

    response = await client.post(
        f"/api/households/{household_id}/shopping-list/clear",
        headers=auth_header(user_id),
    )
    assert response.status_code == 200

    other_list_resp = await client.get(
        f"/api/households/{other_household_id}/shopping-list/items",
        headers=auth_header(user_id),
    )
    assert len(other_list_resp.json()["data"]) == 1


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
