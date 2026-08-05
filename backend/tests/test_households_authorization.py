import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.household import Household
from tests.conftest import auth_header, make_member


def _household(household_id: uuid.UUID, **overrides) -> Household:
    now = datetime.now(UTC)
    defaults = dict(
        id=household_id,
        name="3BR Apartment",
        address=None,
        join_code="ABCD1234",
        created_by_user_id=uuid.uuid4(),
        preferred_unit_system="CUSTOMARY",
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return Household(**defaults)


@pytest.fixture
def fake_households(monkeypatch):
    store: dict[uuid.UUID, Household] = {}
    deleted: set[uuid.UUID] = set()

    def get_household(household_id):
        return store.get(household_id)

    def update_household(household_id, updates):
        household = store.get(household_id)
        if household is None:
            return None
        updated = household.model_copy(update=updates)
        store[household_id] = updated
        return updated

    def delete_household(household_id):
        store.pop(household_id, None)
        deleted.add(household_id)

    monkeypatch.setattr("app.services.households.get_household", get_household)
    monkeypatch.setattr("app.services.households.update_household", update_household)
    monkeypatch.setattr("app.services.households.delete_household", delete_household)

    return {"store": store, "deleted": deleted}


async def test_non_member_cannot_get_household(client, fake_members, fake_households) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()
    fake_households["store"][household_id] = _household(household_id)

    response = await client.get(
        f"/api/households/{household_id}", headers=auth_header(outsider_id)
    )

    assert response.status_code == 403


async def test_member_can_get_household(client, fake_members, fake_households) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    fake_households["store"][household_id] = _household(household_id, name="Casa del Sol")

    response = await client.get(
        f"/api/households/{household_id}", headers=auth_header(user_id)
    )

    assert response.status_code == 200
    assert response.json()["data"]["name"] == "Casa del Sol"


async def test_non_admin_member_cannot_update_household(
    client, fake_members, fake_households
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id, is_admin=False))
    fake_households["store"][household_id] = _household(household_id)

    response = await client.patch(
        f"/api/households/{household_id}",
        json={"name": "New Name"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 403


async def test_admin_can_update_household(client, fake_members, fake_households) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id, is_admin=True))
    fake_households["store"][household_id] = _household(household_id, name="Old Name")

    response = await client.patch(
        f"/api/households/{household_id}",
        json={"name": "New Name", "address": "123 Main St"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body["name"] == "New Name"
    assert body["address"] == "123 Main St"


async def test_updating_nonexistent_household_returns_404(
    client, fake_members, fake_households
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id, is_admin=True))

    response = await client.patch(
        f"/api/households/{household_id}",
        json={"name": "New Name"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_non_admin_member_cannot_delete_household(
    client, fake_members, fake_households
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id, is_admin=False))
    fake_households["store"][household_id] = _household(household_id)

    response = await client.delete(
        f"/api/households/{household_id}", headers=auth_header(user_id)
    )

    assert response.status_code == 403
    assert household_id not in fake_households["deleted"]


async def test_admin_can_delete_household(client, fake_members, fake_households) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id, is_admin=True))
    fake_households["store"][household_id] = _household(household_id)

    response = await client.delete(
        f"/api/households/{household_id}", headers=auth_header(user_id)
    )

    assert response.status_code == 200
    assert household_id in fake_households["deleted"]
