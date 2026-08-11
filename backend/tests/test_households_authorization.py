import uuid

from tests.conftest import auth_header, make_member
from tests.conftest import make_household as _household


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


# ---------------------------------------------------------------------------
# Ownership transfer: owner-only, and only onto an existing active admin --
# the "member -> admin -> owner, one rung at a time" rule.
# ---------------------------------------------------------------------------


async def test_owner_can_transfer_to_an_admin(client, fake_members, fake_households) -> None:
    household_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, owner_id, is_admin=True))
    new_owner_id = uuid.uuid4()
    new_owner = fake_members.seed(make_member(household_id, new_owner_id, is_admin=True))
    fake_households["store"][household_id] = _household(household_id, owner_id=owner_id)

    response = await client.post(
        f"/api/households/{household_id}/transfer-ownership",
        json={"new_owner_member_id": str(new_owner.id)},
        headers=auth_header(owner_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["owner_id"] == str(new_owner_id)


async def test_non_owner_cannot_transfer_ownership(client, fake_members, fake_households) -> None:
    household_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, owner_id, is_admin=True))
    other_admin_id = uuid.uuid4()
    other_admin = fake_members.seed(make_member(household_id, other_admin_id, is_admin=True))
    fake_households["store"][household_id] = _household(household_id, owner_id=owner_id)

    response = await client.post(
        f"/api/households/{household_id}/transfer-ownership",
        json={"new_owner_member_id": str(other_admin.id)},
        headers=auth_header(other_admin_id),
    )

    assert response.status_code == 403


async def test_cannot_transfer_ownership_to_a_non_admin(
    client, fake_members, fake_households
) -> None:
    household_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, owner_id, is_admin=True))
    target_id = uuid.uuid4()
    target = fake_members.seed(make_member(household_id, target_id, is_admin=False))
    fake_households["store"][household_id] = _household(household_id, owner_id=owner_id)

    response = await client.post(
        f"/api/households/{household_id}/transfer-ownership",
        json={"new_owner_member_id": str(target.id)},
        headers=auth_header(owner_id),
    )

    assert response.status_code == 400
