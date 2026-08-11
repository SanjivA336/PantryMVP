import uuid

import pytest

from app.services import members as members_service
from app.services import users as users_service
from tests.conftest import auth_header


@pytest.fixture
def fake_active_memberships(monkeypatch):
    """Backs users_service._active_memberships with whatever rows a test
    seeds directly -- deliberately simpler than composing fake_members +
    fake_households, since the real function does its own joined select
    rather than going through either service's individual functions."""
    rows: list[dict] = []

    def _active_memberships(user_id):
        return rows

    monkeypatch.setattr(users_service, "_active_memberships", _active_memberships)
    return rows


def _row(member_id, household_id, *, is_admin, household_name, owner_id) -> dict:
    return {
        "id": str(member_id),
        "household_id": str(household_id),
        "is_admin": is_admin,
        "households": {"name": household_name, "owner_id": str(owner_id)},
    }


async def test_delete_account_with_no_memberships_succeeds(
    client, fake_active_memberships, monkeypatch
) -> None:
    deleted_ids = []
    monkeypatch.setattr(users_service, "_delete_auth_user", lambda uid: deleted_ids.append(uid))
    user_id = uuid.uuid4()

    response = await client.delete("/api/users/me", headers=auth_header(user_id))

    assert response.status_code == 200
    assert deleted_ids == [user_id]


def _fail_if_called(uid) -> None:
    pytest.fail("should not delete the auth user")


async def test_delete_account_blocked_while_owning_a_household(
    client, fake_active_memberships, monkeypatch
) -> None:
    monkeypatch.setattr(users_service, "_delete_auth_user", _fail_if_called)
    user_id = uuid.uuid4()
    fake_active_memberships.append(
        _row(
            uuid.uuid4(),
            uuid.uuid4(),
            is_admin=True,
            household_name="Casa del Sol",
            owner_id=user_id,
        )
    )

    response = await client.delete("/api/users/me", headers=auth_header(user_id))

    assert response.status_code == 409
    assert "Casa del Sol" in response.json()["error"]["message"]


async def test_delete_account_blocked_as_sole_non_owner_admin(
    client, fake_active_memberships, monkeypatch
) -> None:
    """A co-admin (not the owner) who's the *last* admin left standing
    still can't vanish -- same last-admin safety net /leave already has."""
    monkeypatch.setattr(users_service, "_delete_auth_user", _fail_if_called)
    user_id = uuid.uuid4()
    household_id = uuid.uuid4()
    fake_active_memberships.append(
        _row(
            uuid.uuid4(),
            household_id,
            is_admin=True,
            household_name="Casa del Sol",
            owner_id=uuid.uuid4(),
        )
    )
    monkeypatch.setattr(members_service, "count_active_admins", lambda hid: 1)

    response = await client.delete("/api/users/me", headers=auth_header(user_id))

    assert response.status_code == 409
    assert "Casa del Sol" in response.json()["error"]["message"]


async def test_delete_account_succeeds_for_non_owner_non_last_admin(
    client, fake_active_memberships, monkeypatch
) -> None:
    deactivated = []
    deleted_ids = []
    monkeypatch.setattr(users_service, "_delete_auth_user", lambda uid: deleted_ids.append(uid))
    monkeypatch.setattr(members_service, "count_active_admins", lambda hid: 2)
    monkeypatch.setattr(
        members_service,
        "deactivate_member",
        lambda hid, mid: deactivated.append((hid, mid)),
    )

    user_id = uuid.uuid4()
    household_id = uuid.uuid4()
    member_id = uuid.uuid4()
    fake_active_memberships.append(
        _row(
            member_id,
            household_id,
            is_admin=True,
            household_name="Casa del Sol",
            owner_id=uuid.uuid4(),
        )
    )

    response = await client.delete("/api/users/me", headers=auth_header(user_id))

    assert response.status_code == 200
    assert deactivated == [(household_id, member_id)]
    assert deleted_ids == [user_id]
