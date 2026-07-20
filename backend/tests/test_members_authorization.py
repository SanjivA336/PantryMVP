import uuid

from tests.conftest import auth_header
from tests.conftest import make_member as _member


async def test_non_member_cannot_list_members(client, fake_members) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.get(
        f"/api/households/{household_id}/members", headers=auth_header(outsider_id)
    )

    assert response.status_code == 403


async def test_member_can_list_members(client, fake_members) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(_member(household_id, user_id, is_admin=False))

    response = await client.get(
        f"/api/households/{household_id}/members", headers=auth_header(user_id)
    )

    assert response.status_code == 200
    assert response.json()["status"] == "success"


async def test_non_admin_cannot_promote_another_member(client, fake_members) -> None:
    household_id = uuid.uuid4()
    caller_id = uuid.uuid4()
    fake_members.seed(_member(household_id, caller_id, is_admin=False))
    target = fake_members.seed(_member(household_id, uuid.uuid4(), is_admin=False))

    response = await client.patch(
        f"/api/households/{household_id}/members/{target.id}",
        json={"is_admin": True},
        headers=auth_header(caller_id),
    )

    assert response.status_code == 403


async def test_admin_cannot_demote_the_last_active_admin(client, fake_members) -> None:
    household_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    admin = fake_members.seed(_member(household_id, admin_id, is_admin=True))

    response = await client.patch(
        f"/api/households/{household_id}/members/{admin.id}",
        json={"is_admin": False},
        headers=auth_header(admin_id),
    )

    assert response.status_code == 409


async def test_admin_can_demote_when_another_admin_remains(client, fake_members) -> None:
    household_id = uuid.uuid4()
    admin_a_id = uuid.uuid4()
    admin_a = fake_members.seed(_member(household_id, admin_a_id, is_admin=True))
    fake_members.seed(_member(household_id, uuid.uuid4(), is_admin=True))

    response = await client.patch(
        f"/api/households/{household_id}/members/{admin_a.id}",
        json={"is_admin": False},
        headers=auth_header(admin_a_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["is_admin"] is False


async def test_sole_admin_cannot_leave(client, fake_members) -> None:
    household_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    admin = fake_members.seed(_member(household_id, admin_id, is_admin=True))

    response = await client.post(
        f"/api/households/{household_id}/members/{admin.id}/leave",
        headers=auth_header(admin_id),
    )

    assert response.status_code == 409


async def test_non_admin_member_can_leave(client, fake_members) -> None:
    household_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    fake_members.seed(_member(household_id, admin_id, is_admin=True))
    member_id = uuid.uuid4()
    member = fake_members.seed(_member(household_id, member_id, is_admin=False))

    response = await client.post(
        f"/api/households/{household_id}/members/{member.id}/leave",
        headers=auth_header(member_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["is_active"] is False


async def test_cannot_leave_on_behalf_of_someone_else(client, fake_members) -> None:
    household_id = uuid.uuid4()
    caller_id = uuid.uuid4()
    fake_members.seed(_member(household_id, caller_id, is_admin=False))
    other = fake_members.seed(_member(household_id, uuid.uuid4(), is_admin=False))

    response = await client.post(
        f"/api/households/{household_id}/members/{other.id}/leave",
        headers=auth_header(caller_id),
    )

    assert response.status_code == 403


async def test_admin_can_remove_another_member(client, fake_members) -> None:
    household_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    fake_members.seed(_member(household_id, admin_id, is_admin=True))
    target = fake_members.seed(_member(household_id, uuid.uuid4(), is_admin=False))

    response = await client.delete(
        f"/api/households/{household_id}/members/{target.id}",
        headers=auth_header(admin_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["is_active"] is False


async def test_non_admin_cannot_remove_another_member(client, fake_members) -> None:
    household_id = uuid.uuid4()
    caller_id = uuid.uuid4()
    fake_members.seed(_member(household_id, caller_id, is_admin=False))
    target = fake_members.seed(_member(household_id, uuid.uuid4(), is_admin=False))

    response = await client.delete(
        f"/api/households/{household_id}/members/{target.id}",
        headers=auth_header(caller_id),
    )

    assert response.status_code == 403
