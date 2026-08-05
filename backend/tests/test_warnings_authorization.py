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


async def test_non_member_cannot_ignore_stock_warning(client, fake_members) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/warnings/stock/{uuid.uuid4()}/ignore",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_ignore_stock_warning(client, fake_members, monkeypatch) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    calls = []
    monkeypatch.setattr(
        "app.services.warnings.ignore_stock_warning",
        lambda hh, variant_id, reference_unit: calls.append((hh, variant_id, reference_unit)),
    )
    variant_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/warnings/stock/{variant_id}/ignore",
        params={"reference_unit": "g"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert calls == [(household_id, variant_id, "g")]


async def test_non_member_cannot_ignore_expiry_warning(client, fake_members) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/warnings/expiry/{uuid.uuid4()}/ignore",
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_ignore_expiry_warning(client, fake_members, monkeypatch) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    calls = []
    monkeypatch.setattr(
        "app.services.warnings.ignore_expiry_warning",
        lambda hh, item_id: calls.append((hh, item_id)),
    )
    item_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/warnings/expiry/{item_id}/ignore",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert calls == [(household_id, item_id)]
