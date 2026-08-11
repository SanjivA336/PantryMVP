import uuid
from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from app.schemas.inventory_item import InventoryItem
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
        preferred_unit="g",
        cost=Decimal("4.99"),
        purchased_at=now,
        expiry_date=date(2026, 12, 31),
        best_by_date=None,
        freeze_by_date=None,
        is_frozen=False,
        freeze_date=None,
        status="ACTIVE",
        accounting_type="SHARED",
        split_member_count=2,
        debt_frozen_at=None,
        created_at=now,
        updated_at=now,
        food_name="Whole Milk",
        food_type_name="Whole Milk",
        category="DAIRY_ALTERNATIVES",
        name_override=None,
        storage_location_name="Test Fridge",
        allowed_member_ids=[],
    )
    defaults.update(overrides)
    return InventoryItem(**defaults)


@pytest.fixture
def fake_inventory(monkeypatch):
    store: dict[uuid.UUID, InventoryItem] = {}

    def get_by_id(household_id, item_id):
        item = store.get(item_id)
        return item if item and item.household_id == household_id else None

    def update_item(household_id, item_id, body):
        item = store.get(item_id)
        if item is None:
            raise inventory_service.ItemNotFoundError
        fields = body.model_fields_set
        frozen_gated = {"cost", "total_quantity", "allowed_member_ids"}
        if frozen_gated & fields and item.debt_frozen_at is not None:
            raise inventory_service.ItemFrozenError
        updates: dict = {}
        if "expiry_date" in fields:
            updates["expiry_date"] = body.expiry_date
        if "cost" in fields and body.cost is not None:
            updates["cost"] = body.cost
        if "total_quantity" in fields and body.total_quantity is not None:
            updates["total_quantity"] = body.total_quantity
        updated = item.model_copy(update=updates)
        store[item_id] = updated
        return updated

    def correct_item(household_id, member_id, item_id, body):
        item = store.get(item_id)
        if item is None:
            raise inventory_service.ItemNotFoundError
        if item.debt_frozen_at is None:
            raise inventory_service.ItemNotFrozenError
        updates: dict = {}
        if body.new_cost is not None:
            updates["cost"] = body.new_cost
        if body.new_total_quantity is not None:
            updates["total_quantity"] = body.new_total_quantity
        updated = item.model_copy(update=updates)
        store[item_id] = updated
        return updated

    monkeypatch.setattr("app.services.inventory_items.get_by_id", get_by_id)
    monkeypatch.setattr("app.services.inventory_items.update_item", update_item)
    monkeypatch.setattr("app.services.inventory_items.correct_item", correct_item)
    monkeypatch.setattr(
        "app.services.inventory_items.allowed_member_ids_are_valid", lambda h, ids: True
    )
    monkeypatch.setattr("app.services.inventory_items.list_corrections", lambda h, i: [])

    return store


async def test_member_can_edit_expiry_date_on_a_live_item(
    client, fake_members, fake_inventory
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id)
    fake_inventory[item.id] = item

    response = await client.patch(
        f"/api/households/{household_id}/inventory-items/{item.id}",
        json={"expiry_date": "2027-01-01"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["expiry_date"] == "2027-01-01"


async def test_member_can_edit_cost_while_live(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id, debt_frozen_at=None)
    fake_inventory[item.id] = item

    response = await client.patch(
        f"/api/households/{household_id}/inventory-items/{item.id}",
        json={"cost": "9.99"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["cost"] == "9.99"


async def test_member_cannot_edit_cost_once_frozen(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(
        household_id, debt_frozen_at=datetime.now(UTC), status="EMPTY", quantity=Decimal(0)
    )
    fake_inventory[item.id] = item

    response = await client.patch(
        f"/api/households/{household_id}/inventory-items/{item.id}",
        json={"cost": "9.99"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 409


async def test_dates_stay_editable_even_once_frozen(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(
        household_id, debt_frozen_at=datetime.now(UTC), status="EMPTY", quantity=Decimal(0)
    )
    fake_inventory[item.id] = item

    response = await client.patch(
        f"/api/households/{household_id}/inventory-items/{item.id}",
        json={"expiry_date": "2027-06-01"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200


async def test_correction_rejected_while_item_is_still_live(
    client, fake_members, fake_inventory
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(household_id, debt_frozen_at=None)
    fake_inventory[item.id] = item

    response = await client.post(
        f"/api/households/{household_id}/inventory-items/{item.id}/corrections",
        json={"new_cost": "3.00"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 400


async def test_correction_accepted_once_frozen(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(
        household_id, debt_frozen_at=datetime.now(UTC), status="EMPTY", quantity=Decimal(0)
    )
    fake_inventory[item.id] = item

    response = await client.post(
        f"/api/households/{household_id}/inventory-items/{item.id}/corrections",
        json={"new_cost": "3.00", "note": "typo'd the receipt"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["cost"] == "3.00"


async def test_correction_requires_at_least_one_field(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    item = _item(
        household_id, debt_frozen_at=datetime.now(UTC), status="EMPTY", quantity=Decimal(0)
    )
    fake_inventory[item.id] = item

    response = await client.post(
        f"/api/households/{household_id}/inventory-items/{item.id}/corrections",
        json={"note": "nothing to actually change"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 422


async def test_non_member_cannot_update_item(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.patch(
        f"/api/households/{household_id}/inventory-items/{uuid.uuid4()}",
        json={"expiry_date": "2027-01-01"},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_non_member_cannot_correct_item(client, fake_members, fake_inventory) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/inventory-items/{uuid.uuid4()}/corrections",
        json={"new_cost": "1.00"},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403
