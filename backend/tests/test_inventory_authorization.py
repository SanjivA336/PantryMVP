import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.schemas.inventory_item import InventoryItem, InventoryItemStatus
from app.services import inventory_items as inventory_service
from tests.conftest import auth_header, make_member


def _item(household_id: uuid.UUID, **overrides) -> InventoryItem:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        household_food_variant_id=uuid.uuid4(),
        storage_location_id=uuid.uuid4(),
        purchase_event_id=uuid.uuid4(),
        quantity=Decimal("5"),
        total_quantity=Decimal("5"),
        preferred_unit="count",
        cost=Decimal("4.99"),
        purchased_at=now,
        expiry_date=date(2026, 12, 31),
        best_by_date=None,
        freeze_by_date=None,
        is_frozen=False,
        freeze_date=None,
        status="ACTIVE",
        created_at=now,
        updated_at=now,
        food_name="Whole Milk",
        storage_location_name="Test Fridge",
    )
    defaults.update(overrides)
    return InventoryItem(**defaults)


@pytest.fixture
def fake_inventory(monkeypatch):
    store: dict[uuid.UUID, InventoryItem] = {}

    def create_manual(household_id, member_id, body):
        item = _item(household_id, quantity=body.quantity, total_quantity=body.quantity)
        store[item.id] = item
        return item

    def list_for_household(household_id, status=None):
        items = [i for i in store.values() if i.household_id == household_id]
        if status:
            items = [i for i in items if i.status == status]
        return items

    def get_by_id(household_id, item_id):
        item = store.get(item_id)
        return item if item and item.household_id == household_id else None

    def consume(household_id, member_id, item_id, quantity_used):
        item = store.get(item_id)
        if item is None or quantity_used > item.quantity:
            raise inventory_service.InsufficientQuantityError
        updated = item.model_copy(update={"quantity": item.quantity - quantity_used})
        store[item_id] = updated
        return updated

    def discard(household_id, item_id, reason):
        item = store.get(item_id)
        if item is None or item.status != "ACTIVE":
            raise ValueError("Item not found or not currently active")
        updated = item.model_copy(update={"status": InventoryItemStatus(reason.value)})
        store[item_id] = updated
        return updated

    monkeypatch.setattr("app.services.inventory_items.create_manual", create_manual)
    monkeypatch.setattr("app.services.inventory_items.list_for_household", list_for_household)
    monkeypatch.setattr("app.services.inventory_items.get_by_id", get_by_id)
    monkeypatch.setattr("app.services.inventory_items.consume", consume)
    monkeypatch.setattr("app.services.inventory_items.discard", discard)
    monkeypatch.setattr(
        "app.services.inventory_items.allowed_member_ids_are_valid", lambda h, ids: True
    )

    return store


def _create_body(**overrides) -> dict:
    body = {
        "global_food_definition_id": str(uuid.uuid4()),
        "storage_location_id": str(uuid.uuid4()),
        "quantity": "5",
        "preferred_unit": "count",
        "cost": "4.99",
        "allowed_member_ids": [str(uuid.uuid4())],
    }
    body.update(overrides)
    return body


async def test_non_member_cannot_create_item(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/inventory-items",
        json=_create_body(),
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_create_item(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.post(
        f"/api/households/{household_id}/inventory-items",
        json=_create_body(),
        headers=auth_header(user_id),
    )

    assert response.status_code == 201
    assert response.json()["data"]["quantity"] == "5"


async def test_create_item_rejects_invalid_allowed_members(
    client, fake_members, fake_inventory, monkeypatch
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    monkeypatch.setattr(
        "app.services.inventory_items.allowed_member_ids_are_valid", lambda h, ids: False
    )

    response = await client.post(
        f"/api/households/{household_id}/inventory-items",
        json=_create_body(),
        headers=auth_header(user_id),
    )

    assert response.status_code == 400


async def test_get_nonexistent_item_returns_404(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.get(
        f"/api/households/{household_id}/inventory-items/{uuid.uuid4()}",
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_consume_more_than_available_is_rejected(
    client, fake_members, fake_inventory
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id, quantity=Decimal("2"))
    fake_inventory[item.id] = item

    response = await client.post(
        f"/api/households/{household_id}/inventory-items/{item.id}/consume",
        json={"quantity_used": "3"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 400
    # Confirm the rejected attempt didn't partially decrement anything.
    assert fake_inventory[item.id].quantity == Decimal("2")


async def test_consume_within_available_succeeds(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id, quantity=Decimal("5"))
    fake_inventory[item.id] = item

    response = await client.post(
        f"/api/households/{household_id}/inventory-items/{item.id}/consume",
        json={"quantity_used": "2"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["quantity"] == "3"


async def test_discard_nonactive_item_returns_404(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id, status="DISCARDED")
    fake_inventory[item.id] = item

    response = await client.delete(
        f"/api/households/{household_id}/inventory-items/{item.id}",
        params={"reason": "DISCARDED"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_discard_active_item_succeeds(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id, status="ACTIVE")
    fake_inventory[item.id] = item

    response = await client.delete(
        f"/api/households/{household_id}/inventory-items/{item.id}",
        params={"reason": "EXPIRED"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "EXPIRED"
