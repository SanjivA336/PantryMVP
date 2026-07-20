import uuid

import pytest

from app.schemas.warning import HouseholdWarnings
from tests.conftest import auth_header, make_member


@pytest.fixture
def fake_warnings(monkeypatch):
    results: dict[uuid.UUID, HouseholdWarnings] = {}

    def compute_warnings(household_id):
        return results.get(household_id, HouseholdWarnings(expiry_warnings=[], stock_warnings=[]))

    monkeypatch.setattr("app.services.warnings.compute_warnings", compute_warnings)
    return results


async def test_non_member_cannot_view_warnings(client, fake_members, fake_warnings) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.get(
        f"/api/households/{household_id}/warnings",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_view_warnings(client, fake_members, fake_warnings) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.get(
        f"/api/households/{household_id}/warnings",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    body = response.json()["data"]
    assert body == {"expiry_warnings": [], "stock_warnings": []}
