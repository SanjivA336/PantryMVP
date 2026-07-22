import uuid
from datetime import UTC, datetime

import pytest

from app.schemas.receipt_import import (
    CreateReceiptImportSessionResponse,
    ReceiptImportItem,
    ReceiptImportItemStatus,
    ReceiptImportSession,
    ReceiptImportSessionStatus,
    ReceiptImportSessionWithItems,
)
from app.services import receipt_imports as receipt_import_service
from tests.conftest import auth_header, make_member


def _session(household_id: uuid.UUID, **overrides) -> ReceiptImportSession:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        household_id=household_id,
        created_by_member_id=uuid.uuid4(),
        status="COMPLETED",
        image_path=f"{household_id}/{uuid.uuid4()}.jpg",
        ocr_engine="google_vision",
        raw_ocr_text="MILK 4.99",
        error_message=None,
        processed_at=now,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return ReceiptImportSession(**defaults)


def _item(session_id: uuid.UUID, **overrides) -> ReceiptImportItem:
    now = datetime.now(UTC)
    defaults = dict(
        id=uuid.uuid4(),
        session_id=session_id,
        position=0,
        raw_line_text="MILK 4.99",
        parsed_name="MILK",
        parsed_quantity=None,
        parsed_unit=None,
        parsed_price="4.99",
        global_food_definition_id=None,
        food_name=None,
        storage_location_id=None,
        storage_location_name=None,
        quantity=None,
        preferred_unit=None,
        cost="4.99",
        accounting_type=None,
        allowed_member_ids=[],
        status="NEEDS_REVIEW",
        created_inventory_item_id=None,
        created_at=now,
        updated_at=now,
    )
    defaults.update(overrides)
    return ReceiptImportItem(**defaults)


def _with_items(
    session: ReceiptImportSession, items: list[ReceiptImportItem]
) -> ReceiptImportSessionWithItems:
    return ReceiptImportSessionWithItems(**session.model_dump(), items=items)


@pytest.fixture
def fake_receipt_imports(monkeypatch):
    store: dict[uuid.UUID, ReceiptImportSessionWithItems] = {}

    def create_session(household_id, member_id, filename):
        session = _session(household_id, created_by_member_id=member_id, status="PENDING")
        store[session.id] = _with_items(session, [])
        return CreateReceiptImportSessionResponse(
            id=session.id, upload_bucket="receipt-images", upload_path=session.image_path
        )

    def list_for_household(household_id, status=None):
        sessions = [s for s in store.values() if s.household_id == household_id]
        if status:
            sessions = [s for s in sessions if s.status == status]
        return [ReceiptImportSession(**s.model_dump(exclude={"items"})) for s in sessions]

    def get_by_id(household_id, session_id):
        session = store.get(session_id)
        return session if session and session.household_id == household_id else None

    def process_session(household_id, session_id):
        session = store.get(session_id)
        if session is None or session.household_id != household_id:
            raise receipt_import_service.SessionNotFoundError
        if session.status not in ("PENDING", "FAILED"):
            raise receipt_import_service.InvalidSessionStateError(session.status)
        updated = session.model_copy(update={"status": ReceiptImportSessionStatus.COMPLETED})
        store[session_id] = updated
        return updated

    def update_item(household_id, session_id, item_id, body):
        session = store.get(session_id)
        if session is None or session.household_id != household_id:
            raise receipt_import_service.SessionNotFoundError
        item = next((i for i in session.items if i.id == item_id), None)
        if item is None:
            raise receipt_import_service.ItemNotFoundError
        updates = body.model_dump(exclude_none=True)
        updated_item = item.model_copy(update=updates)
        new_items = [updated_item if i.id == item_id else i for i in session.items]
        store[session_id] = session.model_copy(update={"items": new_items})
        return updated_item

    def finalize(household_id, session_id, member_id):
        session = store.get(session_id)
        if session is None or session.household_id != household_id:
            raise receipt_import_service.SessionNotFoundError
        if any(i.status == ReceiptImportItemStatus.NEEDS_REVIEW for i in session.items):
            raise receipt_import_service.FinalizeValidationError("items need review")
        updated = session.model_copy(update={"status": ReceiptImportSessionStatus.FINALIZED})
        store[session_id] = updated
        return updated

    monkeypatch.setattr("app.services.receipt_imports.create_session", create_session)
    monkeypatch.setattr("app.services.receipt_imports.list_for_household", list_for_household)
    monkeypatch.setattr("app.services.receipt_imports.get_by_id", get_by_id)
    monkeypatch.setattr("app.services.receipt_imports.process_session", process_session)
    monkeypatch.setattr("app.services.receipt_imports.update_item", update_item)
    monkeypatch.setattr("app.services.receipt_imports.finalize", finalize)

    return store


async def test_non_member_cannot_create_session(client, fake_members, fake_receipt_imports) -> None:
    household_id = uuid.uuid4()
    outsider_id = uuid.uuid4()

    response = await client.post(
        f"/api/households/{household_id}/receipt-import-sessions",
        json={},
        headers=auth_header(outsider_id),
    )

    assert response.status_code == 403


async def test_member_can_create_and_list_sessions(
    client, fake_members, fake_receipt_imports
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    create_resp = await client.post(
        f"/api/households/{household_id}/receipt-import-sessions",
        json={"filename": "receipt.jpg"},
        headers=auth_header(user_id),
    )
    assert create_resp.status_code == 201, create_resp.text
    assert create_resp.json()["data"]["upload_bucket"] == "receipt-images"

    list_resp = await client.get(
        f"/api/households/{household_id}/receipt-import-sessions",
        headers=auth_header(user_id),
    )
    assert list_resp.status_code == 200
    assert len(list_resp.json()["data"]) == 1


async def test_get_nonexistent_session_returns_404(
    client, fake_members, fake_receipt_imports
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))

    response = await client.get(
        f"/api/households/{household_id}/receipt-import-sessions/{uuid.uuid4()}",
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_process_already_completed_session_returns_409(
    client, fake_members, fake_receipt_imports
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    session = _session(household_id, status="COMPLETED")
    fake_receipt_imports[session.id] = _with_items(session, [])

    response = await client.post(
        f"/api/households/{household_id}/receipt-import-sessions/{session.id}/process",
        headers=auth_header(user_id),
    )

    assert response.status_code == 409


async def test_update_nonexistent_item_returns_404(
    client, fake_members, fake_receipt_imports
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    session = _session(household_id, status="COMPLETED")
    fake_receipt_imports[session.id] = _with_items(session, [])

    response = await client.patch(
        f"/api/households/{household_id}/receipt-import-sessions/{session.id}/items/{uuid.uuid4()}",
        json={"status": "CONFIRMED"},
        headers=auth_header(user_id),
    )

    assert response.status_code == 404


async def test_finalize_with_unreviewed_item_returns_400(
    client, fake_members, fake_receipt_imports
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    session = _session(household_id, status="COMPLETED")
    item = _item(session.id, status="NEEDS_REVIEW")
    fake_receipt_imports[session.id] = _with_items(session, [item])

    response = await client.post(
        f"/api/households/{household_id}/receipt-import-sessions/{session.id}/finalize",
        headers=auth_header(user_id),
    )

    assert response.status_code == 400


async def test_finalize_succeeds_when_all_items_reviewed(
    client, fake_members, fake_receipt_imports
) -> None:
    household_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fake_members.seed(make_member(household_id, user_id))
    session = _session(household_id, status="COMPLETED")
    item = _item(session.id, status="SKIPPED")
    fake_receipt_imports[session.id] = _with_items(session, [item])

    response = await client.post(
        f"/api/households/{household_id}/receipt-import-sessions/{session.id}/finalize",
        headers=auth_header(user_id),
    )

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "FINALIZED"
