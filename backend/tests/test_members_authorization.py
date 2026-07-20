import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.member import Member
from tests.conftest import auth_header


def _member(
    household_id: uuid.UUID, user_id: uuid.UUID, *, is_admin: bool, is_active: bool = True
) -> Member:
    now = datetime.now(UTC)
    return Member(
        id=uuid.uuid4(),
        household_id=household_id,
        user_id=user_id,
        nickname="Test Member",
        is_admin=is_admin,
        is_active=is_active,
        created_at=now,
        updated_at=now,
    )


class MemberStore(dict):
    def seed(self, member: Member) -> Member:
        self[(member.household_id, member.id)] = member
        return member


@pytest.fixture
def fake_members(monkeypatch):
    store: MemberStore = MemberStore()

    def get_active_member(household_id, user_id):
        return next(
            (
                m
                for m in store.values()
                if m.household_id == household_id and m.user_id == user_id and m.is_active
            ),
            None,
        )

    def get_member_by_id(household_id, member_id):
        return store.get((household_id, member_id))

    def list_members(household_id):
        return [m for m in store.values() if m.household_id == household_id]

    def count_active_admins(household_id):
        return sum(
            1
            for m in store.values()
            if m.household_id == household_id and m.is_admin and m.is_active
        )

    def update_member(household_id, member_id, updates):
        current = store[(household_id, member_id)]
        updated = current.model_copy(update=updates)
        store[(household_id, member_id)] = updated
        return updated

    def deactivate_member(household_id, member_id):
        return update_member(household_id, member_id, {"is_active": False})

    monkeypatch.setattr("app.services.members.get_active_member", get_active_member)
    monkeypatch.setattr("app.services.members.get_member_by_id", get_member_by_id)
    monkeypatch.setattr("app.services.members.list_members", list_members)
    monkeypatch.setattr("app.services.members.count_active_admins", count_active_admins)
    monkeypatch.setattr("app.services.members.update_member", update_member)
    monkeypatch.setattr("app.services.members.deactivate_member", deactivate_member)

    return store


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
