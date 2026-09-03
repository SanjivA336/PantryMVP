import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.activity import ActivityEvent, ActivityType
from tests.conftest import auth_header, make_member


def _event(household_id: uuid.UUID, **overrides) -> ActivityEvent:
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        type=ActivityType.ITEM_ADDED,
        actor_member_id=uuid.uuid4(),
        actor_nickname="Sam",
        subject_name="Butter",
        detail={"quantity": "1", "unit": "count", "storage_location": "Fridge"},
        created_at=datetime.now(UTC),
    )
    defaults.update(overrides)
    return ActivityEvent(**defaults)


@pytest.fixture
def fake_activity(monkeypatch):
    feed: dict[uuid.UUID, list[ActivityEvent]] = {}
    calls: dict = {}

    def list_feed(household_id, *, types=None, limit=50, before=None):
        calls["types"] = types
        calls["limit"] = limit
        calls["before"] = before
        return feed.get(household_id, [])

    monkeypatch.setattr("app.services.activity.list_feed", list_feed)
    return {"feed": feed, "calls": calls}


async def test_non_member_cannot_view_activity(client, fake_members, fake_activity) -> None:
    household_id = uuid.uuid4()
    response = await client.get(
        f"/api/households/{household_id}/activity",
        headers=auth_header(uuid.uuid4()),
    )
    assert response.status_code == 403


async def test_member_sees_the_feed(client, fake_members, fake_activity) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    fake_activity["feed"][household_id] = [_event(household_id, subject_name="Eggs")]

    response = await client.get(
        f"/api/households/{household_id}/activity",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert len(body) == 1
    assert body[0]["type"] == "ITEM_ADDED"
    assert body[0]["subject_name"] == "Eggs"
    assert body[0]["detail"]["unit"] == "count"


async def test_type_filter_reaches_the_service(client, fake_members, fake_activity) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.get(
        f"/api/households/{household_id}/activity?type=ITEM_ADDED&type=MEMBER_JOINED",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert fake_activity["calls"]["types"] == [
        ActivityType.ITEM_ADDED,
        ActivityType.MEMBER_JOINED,
    ]


async def test_before_cursor_reaches_the_service(client, fake_members, fake_activity) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    # %2B is how the frontend's encodeURIComponent renders the "+00:00"
    # offset it reads back off the oldest row.
    cursor = "2026-01-01T00:00:00%2B00:00"

    response = await client.get(
        f"/api/households/{household_id}/activity?before={cursor}&limit=10",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert fake_activity["calls"]["limit"] == 10
    assert fake_activity["calls"]["before"] == datetime(2026, 1, 1, tzinfo=UTC)


async def test_bad_type_filter_is_rejected(client, fake_members, fake_activity) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.get(
        f"/api/households/{household_id}/activity?type=NOT_A_REAL_TYPE",
        headers=auth_header(user_id),
    )

    assert response.status_code == 422
