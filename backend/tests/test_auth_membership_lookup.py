import threading
import uuid

from tests.conftest import auth_header
from tests.conftest import make_household as _household
from tests.conftest import make_member as _member


async def test_membership_check_runs_both_lookups_at_the_same_time(
    client, fake_households, monkeypatch
) -> None:
    # Each stub waits for the other at a barrier. That only succeeds if the two
    # lookups genuinely overlap: if someone makes them run one after the other
    # again, the first would wait forever, the barrier would time out, and this
    # test would fail.
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_households["store"][household_id] = _household(household_id)
    barrier = threading.Barrier(2, timeout=3)

    def user_exists(_user_id) -> bool:
        barrier.wait()
        return True

    def get_active_member(hid, uid):
        barrier.wait()
        return _member(hid, uid)

    monkeypatch.setattr("app.services.users.user_exists", user_exists)
    monkeypatch.setattr("app.services.members.get_active_member", get_active_member)

    response = await client.get(f"/api/households/{household_id}", headers=auth_header(user_id))

    assert response.status_code == 200


async def test_deleted_account_is_a_401_even_with_a_membership_row(
    client, fake_members, fake_households, monkeypatch
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(_member(household_id, user_id))
    fake_households["store"][household_id] = _household(household_id)
    monkeypatch.setattr("app.services.users.user_exists", lambda _user_id: False)

    response = await client.get(f"/api/households/{household_id}", headers=auth_header(user_id))

    assert response.status_code == 401


async def test_non_member_is_still_a_403(client, fake_members, fake_households) -> None:
    household_id = uuid.uuid4()
    fake_households["store"][household_id] = _household(household_id)

    response = await client.get(
        f"/api/households/{household_id}", headers=auth_header(uuid.uuid4())
    )

    assert response.status_code == 403
