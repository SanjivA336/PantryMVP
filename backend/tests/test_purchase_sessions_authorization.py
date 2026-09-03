import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.purchase_session import (
    CreateReceiptSessionResponse,
    PurchaseSession,
    PurchaseSessionItem,
    PurchaseSessionWithItems,
)
from app.services import purchase_sessions as pss
from tests.conftest import auth_header, make_developer, make_member

_PREFIX = "/api/households/{hh}/purchase-sessions"


def _session(household_id, **overrides) -> PurchaseSession:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        created_by_member_id=uuid.uuid4(),
        source="SHOPPING_LIST",
        status="PENDING",
        image_path=None,
        ocr_engine=None,
        raw_ocr_text=None,
        error_message=None,
        processed_at=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return PurchaseSession(**defaults)


def _item(session_id, **overrides) -> PurchaseSessionItem:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        session_id=session_id,
        position=0,
        raw_line_text="Milk",
        parsed_name=None,
        parsed_quantity=None,
        parsed_unit=None,
        parsed_price=None,
        global_food_definition_id=None,
        food_name=None,
        category=None,
        storage_location_id=None,
        storage_location_name=None,
        quantity=None,
        preferred_unit=None,
        cost=None,
        accounting_type=None,
        allowed_member_ids=[],
        buyer_member_id=None,
        shopping_list_item_id=uuid.uuid4(),
        status="PENDING",
        created_inventory_item_id=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return PurchaseSessionItem(**defaults)


def _with_items(session, items) -> PurchaseSessionWithItems:
    return PurchaseSessionWithItems(**session.model_dump(), items=items)


@pytest.fixture
def fake_sessions(monkeypatch):
    store: dict[uuid.UUID, PurchaseSessionWithItems] = {}

    def create_from_shopping_list(household_id, member_id):
        if not store.get("_has_collected", True):
            raise pss.NothingToBuyError
        s = _session(household_id, created_by_member_id=member_id)
        store[s.id] = _with_items(s, [])
        return store[s.id]

    def create_receipt_session(household_id, member_id, filename):
        return CreateReceiptSessionResponse(
            id=uuid.uuid4(), upload_bucket="receipt-images", upload_path=f"{household_id}/x.jpg"
        )

    def get_by_id(household_id, session_id):
        s = store.get(session_id)
        return s if s and s.household_id == household_id else None

    def finalize(household_id, session_id, member_id):
        s = store.get(session_id)
        if s is None or s.household_id != household_id:
            raise pss.SessionNotFoundError
        if any(i.status == "PENDING" for i in s.items):
            raise pss.FinalizeValidationError("incomplete lines")
        updated = s.model_copy(update={"status": pss.PurchaseSessionStatus.FINALIZED})
        store[session_id] = updated
        return updated

    def delete_session(household_id, session_id):
        s = store.get(session_id)
        if s is None or s.household_id != household_id:
            raise pss.SessionNotFoundError
        if s.status == "FINALIZED":
            raise pss.InvalidSessionStateError("FINALIZED")
        del store[session_id]

    monkeypatch.setattr(pss, "create_from_shopping_list", create_from_shopping_list)
    monkeypatch.setattr(pss, "create_receipt_session", create_receipt_session)
    monkeypatch.setattr(pss, "get_by_id", get_by_id)
    monkeypatch.setattr(pss, "finalize", finalize)
    monkeypatch.setattr(pss, "delete_session", delete_session)
    return store


async def test_non_member_cannot_start_a_session(client, fake_members, fake_sessions) -> None:
    hh = uuid.uuid4()
    r = await client.post(
        f"{_PREFIX.format(hh=hh)}/from-shopping-list", headers=auth_header(uuid.uuid4())
    )
    assert r.status_code == 403


async def test_member_can_start_finalize_and_delete_without_developer_access(
    client, fake_members, fake_sessions
) -> None:
    hh, uid = uuid.uuid4(), uuid.uuid4()
    fake_members.seed(make_member(hh, uid))  # a plain member, NOT a developer

    start = await client.post(
        f"{_PREFIX.format(hh=hh)}/from-shopping-list", headers=auth_header(uid)
    )
    assert start.status_code == 201, start.text
    session_id = start.json()["data"]["id"]

    got = await client.get(f"{_PREFIX.format(hh=hh)}/{session_id}", headers=auth_header(uid))
    assert got.status_code == 200

    fin = await client.post(
        f"{_PREFIX.format(hh=hh)}/{session_id}/finalize", headers=auth_header(uid)
    )
    assert fin.status_code == 200
    assert fin.json()["data"]["status"] == "FINALIZED"

    # A finalized session can't be deleted.
    gone = await client.delete(f"{_PREFIX.format(hh=hh)}/{session_id}", headers=auth_header(uid))
    assert gone.status_code == 409


async def test_receipt_create_requires_developer(client, fake_members, fake_sessions) -> None:
    hh, uid = uuid.uuid4(), uuid.uuid4()
    fake_members.seed(make_member(hh, uid))

    denied = await client.post(
        f"{_PREFIX.format(hh=hh)}/receipt", json={}, headers=auth_header(uid)
    )
    assert denied.status_code == 403


async def test_receipt_create_allowed_for_developer(
    client, fake_members, fake_sessions, monkeypatch
) -> None:
    hh, uid = uuid.uuid4(), uuid.uuid4()
    fake_members.seed(make_member(hh, uid))
    make_developer(monkeypatch, uid)

    ok_resp = await client.post(
        f"{_PREFIX.format(hh=hh)}/receipt", json={"filename": "r.jpg"}, headers=auth_header(uid)
    )
    assert ok_resp.status_code == 201
    assert ok_resp.json()["data"]["upload_bucket"] == "receipt-images"


async def test_finalize_with_incomplete_line_is_400(client, fake_members, fake_sessions) -> None:
    hh, uid = uuid.uuid4(), uuid.uuid4()
    fake_members.seed(make_member(hh, uid))
    s = _session(hh)
    fake_sessions[s.id] = _with_items(s, [_item(s.id, status="PENDING")])

    r = await client.post(f"{_PREFIX.format(hh=hh)}/{s.id}/finalize", headers=auth_header(uid))
    assert r.status_code == 400


async def test_start_with_nothing_collected_is_400(client, fake_members, fake_sessions) -> None:
    hh, uid = uuid.uuid4(), uuid.uuid4()
    fake_members.seed(make_member(hh, uid))
    fake_sessions["_has_collected"] = False

    r = await client.post(f"{_PREFIX.format(hh=hh)}/from-shopping-list", headers=auth_header(uid))
    assert r.status_code == 400


async def test_get_missing_session_is_404(client, fake_members, fake_sessions) -> None:
    hh, uid = uuid.uuid4(), uuid.uuid4()
    fake_members.seed(make_member(hh, uid))
    r = await client.get(f"{_PREFIX.format(hh=hh)}/{uuid.uuid4()}", headers=auth_header(uid))
    assert r.status_code == 404
