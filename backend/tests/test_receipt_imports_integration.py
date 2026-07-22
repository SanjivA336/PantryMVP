"""Integration tests for receipt import sessions against the real linked
Supabase project. `run_ocr` is monkeypatched (a real OCR API call doesn't
belong in a test run) -- everything downstream (Storage, DB writes, RLS,
the regex parser, finalize reusing the settlement engine) is real. Excluded
from the default run; run explicitly with `uv run pytest -m integration`.
"""

import uuid
from decimal import Decimal

import pytest
from httpx import ASGITransport, AsyncClient

from app.core.supabase import get_service_client
from app.main import app
from app.services.receipt_ocr import OcrResult
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.integration

_PASSWORD = "Burrow-ReceiptImports-Test-123!"
_CANNED_RECEIPT_TEXT = "WHOLE MILK 4.99\nSUBTOTAL 4.99\nTAX 0.30\nTOTAL 5.29"


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


@pytest.fixture
async def household(api_client):
    suffix = uuid.uuid4().hex[:8]
    user = await create_test_user(f"burrow-receipts-test-{suffix}@example.com", _PASSWORD)
    token = await sign_in(user["email"], _PASSWORD)
    headers = {"Authorization": f"Bearer {token}"}

    household_resp = await api_client.post(
        "/api/households",
        json={"name": "Receipt Imports Test House", "nickname": "Tester"},
        headers=headers,
    )
    household_id = household_resp.json()["data"]["id"]
    member_id = (
        await api_client.get(f"/api/households/{household_id}/members", headers=headers)
    ).json()["data"][0]["id"]
    storage_location_id = (
        await api_client.post(
            f"/api/households/{household_id}/storage-locations",
            json={"name": "Test Fridge", "type": "FRIDGE"},
            headers=headers,
        )
    ).json()["data"]["id"]

    yield {
        "household_id": household_id,
        "member_id": member_id,
        "storage_location_id": storage_location_id,
        "headers": headers,
    }

    await api_client.delete(f"/api/households/{household_id}", headers=headers)
    await delete_test_user(user["id"])


async def _create_and_upload_session(api_client, household) -> dict:
    """Creates a session via the API, then uploads placeholder bytes to the
    exact path the backend issued -- `process_session` downloads via the
    service-role client, so real bytes must exist there regardless of the
    OCR call itself being mocked."""
    create_resp = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions",
        json={"filename": "receipt.jpg"},
        headers=household["headers"],
    )
    assert create_resp.status_code == 201, create_resp.text
    created = create_resp.json()["data"]

    service_client = get_service_client()
    service_client.storage.from_(created["upload_bucket"]).upload(
        created["upload_path"],
        b"not a real image, just needs to exist",
        {"content-type": "image/jpeg"},
    )
    return created


async def _search_food(api_client, headers, query: str) -> dict:
    response = await api_client.get(
        "/api/food-definitions/search", params={"query": query}, headers=headers
    )
    return response.json()["data"][0]


async def test_process_parses_lines_and_filters_noise(api_client, household, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.receipt_imports.run_ocr",
        lambda image_bytes, mime_type: OcrResult(raw_text=_CANNED_RECEIPT_TEXT),
    )
    created = await _create_and_upload_session(api_client, household)

    process_resp = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{created['id']}/process",
        headers=household["headers"],
    )
    assert process_resp.status_code == 200, process_resp.text
    session = process_resp.json()["data"]

    assert session["status"] == "COMPLETED"
    # SUBTOTAL/TAX/TOTAL are noise and must be filtered; only the milk line survives.
    assert len(session["items"]) == 1
    assert session["items"][0]["parsed_name"] == "WHOLE MILK"
    assert Decimal(session["items"][0]["parsed_price"]) == Decimal("4.99")


async def test_full_lifecycle_confirm_skip_finalize(api_client, household, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.receipt_imports.run_ocr",
        lambda image_bytes, mime_type: OcrResult(raw_text=_CANNED_RECEIPT_TEXT),
    )
    created = await _create_and_upload_session(api_client, household)
    session_id = created["id"]

    process_resp = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{session_id}/process",
        headers=household["headers"],
    )
    item = process_resp.json()["data"]["items"][0]
    milk = await _search_food(api_client, household["headers"], "Whole Milk")

    confirm_resp = await api_client.patch(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{session_id}/items/{item['id']}",
        json={
            "global_food_definition_id": milk["id"],
            "storage_location_id": household["storage_location_id"],
            "quantity": "1",
            "preferred_unit": "count",
            "cost": "4.99",
            "accounting_type": "PERSONAL",
            "allowed_member_ids": [household["member_id"]],
            "status": "CONFIRMED",
        },
        headers=household["headers"],
    )
    assert confirm_resp.status_code == 200, confirm_resp.text

    finalize_resp = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{session_id}/finalize",
        headers=household["headers"],
    )
    assert finalize_resp.status_code == 200, finalize_resp.text
    finalized = finalize_resp.json()["data"]
    assert finalized["status"] == "FINALIZED"
    assert finalized["items"][0]["status"] == "IMPORTED"
    created_item_id = finalized["items"][0]["created_inventory_item_id"]
    assert created_item_id is not None

    inventory_resp = await api_client.get(
        f"/api/households/{household['household_id']}/inventory-items/{created_item_id}",
        headers=household["headers"],
    )
    assert inventory_resp.status_code == 200
    assert inventory_resp.json()["data"]["food_name"] == "Whole Milk"

    # The resulting purchase_events row carries the receipt's image path.
    settings_client = get_service_client()
    purchase_event_id = inventory_resp.json()["data"]["purchase_event_id"]
    purchase_event = (
        settings_client.table("purchase_events")
        .select("receipt_image_url")
        .eq("id", purchase_event_id)
        .single()
        .execute()
    )
    assert purchase_event.data["receipt_image_url"] == created["upload_path"]

    # Idempotency: finalizing again must not create a second inventory item.
    second_finalize = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{session_id}/finalize",
        headers=household["headers"],
    )
    assert second_finalize.status_code == 200
    assert (
        second_finalize.json()["data"]["items"][0]["created_inventory_item_id"] == created_item_id
    )


async def test_finalize_rejects_unreviewed_items(api_client, household, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.services.receipt_imports.run_ocr",
        lambda image_bytes, mime_type: OcrResult(raw_text=_CANNED_RECEIPT_TEXT),
    )
    created = await _create_and_upload_session(api_client, household)
    await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{created['id']}/process",
        headers=household["headers"],
    )

    finalize_resp = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{created['id']}/finalize",
        headers=household["headers"],
    )
    assert finalize_resp.status_code == 400


async def test_finalize_rejects_zero_quantity_cleanly(api_client, household, monkeypatch) -> None:
    """A confirmed item with quantity <= 0 must produce a clean 400, not an
    unhandled 500 from a Pydantic ValidationError or DB constraint
    violation surfacing straight out of create_manual_inventory_item."""
    monkeypatch.setattr(
        "app.services.receipt_imports.run_ocr",
        lambda image_bytes, mime_type: OcrResult(raw_text=_CANNED_RECEIPT_TEXT),
    )
    created = await _create_and_upload_session(api_client, household)
    process_resp = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{created['id']}/process",
        headers=household["headers"],
    )
    item = process_resp.json()["data"]["items"][0]
    milk = await _search_food(api_client, household["headers"], "Whole Milk")

    confirm_resp = await api_client.patch(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{created['id']}/items/{item['id']}",
        json={
            "global_food_definition_id": milk["id"],
            "storage_location_id": household["storage_location_id"],
            "quantity": "0",
            "preferred_unit": "count",
            "cost": "4.99",
            "accounting_type": "PERSONAL",
            "allowed_member_ids": [household["member_id"]],
            "status": "CONFIRMED",
        },
        headers=household["headers"],
    )
    # quantity=0 fails Pydantic's gt=0 constraint on UpdateReceiptImportItemRequest
    # itself, so this is rejected even earlier, at the PATCH step.
    assert confirm_resp.status_code == 422


async def test_process_retry_after_failure_is_resumable(api_client, household, monkeypatch) -> None:
    created = await _create_and_upload_session(api_client, household)

    def _raise(image_bytes, mime_type):
        raise RuntimeError("simulated OCR outage")

    monkeypatch.setattr("app.services.receipt_imports.run_ocr", _raise)
    first_attempt = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{created['id']}/process",
        headers=household["headers"],
    )
    assert first_attempt.status_code == 200
    failed_session = first_attempt.json()["data"]
    assert failed_session["status"] == "FAILED"
    assert failed_session["items"] == []

    monkeypatch.setattr(
        "app.services.receipt_imports.run_ocr",
        lambda image_bytes, mime_type: OcrResult(raw_text=_CANNED_RECEIPT_TEXT),
    )
    retry = await api_client.post(
        f"/api/households/{household['household_id']}/receipt-import-sessions/{created['id']}/process",
        headers=household["headers"],
    )
    assert retry.status_code == 200
    retried_session = retry.json()["data"]
    assert retried_session["status"] == "COMPLETED"
    assert len(retried_session["items"]) == 1
