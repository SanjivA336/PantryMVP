import logging
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid4

from app.core.config import get_settings
from app.core.supabase import get_service_client
from app.schemas.inventory_item import CreateInventoryItemRequest
from app.schemas.receipt_import import (
    CreateReceiptImportSessionResponse,
    ParsedReceiptItem,
    ReceiptImportItem,
    ReceiptImportItemStatus,
    ReceiptImportSession,
    ReceiptImportSessionStatus,
    ReceiptImportSessionWithItems,
    UpdateReceiptImportItemRequest,
)
from app.services import food_definitions as food_definitions_service
from app.services import inventory_items as inventory_service
from app.services import receipt_parsing
from app.services.ai import get_ai_provider
from app.services.ai.base import AiProviderError
from app.services.receipt_ocr import run_ocr

_SESSIONS_TABLE = "receipt_import_sessions"
_ITEMS_TABLE = "receipt_import_items"
_BUCKET = "receipt-images"

_ENRICHED_ITEM_SELECT = "*, global_food_definitions(name, category), storage_locations(name)"

_logger = logging.getLogger(__name__)


class SessionNotFoundError(Exception):
    pass


class ItemNotFoundError(Exception):
    pass


class InvalidSessionStateError(Exception):
    pass


class FinalizeValidationError(Exception):
    pass


def _flatten_item(row: dict) -> ReceiptImportItem:
    food = row.pop("global_food_definitions", None) or {}
    storage = row.pop("storage_locations", None) or {}
    row["food_name"] = food.get("name")
    row["category"] = food.get("category")
    row["storage_location_name"] = storage.get("name")
    return ReceiptImportItem(**row)


def create_session(
    household_id: UUID, member_id: UUID, filename: str | None
) -> CreateReceiptImportSessionResponse:
    session_id = uuid4()
    ext = "jpg"
    if filename and "." in filename:
        ext = filename.rsplit(".", 1)[-1].lower()
    upload_path = f"{household_id}/{session_id}.{ext}"

    client = get_service_client()
    client.table(_SESSIONS_TABLE).insert(
        {
            "id": str(session_id),
            "household_id": str(household_id),
            "created_by_member_id": str(member_id),
            "status": "PENDING",
            "image_path": upload_path,
        }
    ).execute()

    return CreateReceiptImportSessionResponse(
        id=session_id, upload_bucket=_BUCKET, upload_path=upload_path
    )


def list_for_household(household_id: UUID, status: str | None = None) -> list[ReceiptImportSession]:
    client = get_service_client()
    query = client.table(_SESSIONS_TABLE).select("*").eq("household_id", str(household_id))
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).execute()
    return [ReceiptImportSession(**row) for row in result.data]


def get_by_id(household_id: UUID, session_id: UUID) -> ReceiptImportSessionWithItems | None:
    client = get_service_client()
    session_result = (
        client.table(_SESSIONS_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .eq("id", str(session_id))
        .maybe_single()
        .execute()
    )
    if not session_result or not session_result.data:
        return None

    items_result = (
        client.table(_ITEMS_TABLE)
        .select(_ENRICHED_ITEM_SELECT)
        .eq("session_id", str(session_id))
        .order("position")
        .execute()
    )
    items = [_flatten_item(row) for row in items_result.data]
    return ReceiptImportSessionWithItems(**session_result.data, items=items)


def _coerce_decimal(raw: str | None) -> Decimal | None:
    """The prompt asks for a bare decimal string with no currency symbol,
    but a weak local model doesn't always comply (observed returning
    "$4.66" for price despite the instruction) -- strip common formatting
    before giving up on an otherwise-good value.
    """
    if not raw:
        return None
    cleaned = raw.strip().lstrip("$").replace(",", "")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _ai_items_to_parsed_lines(items: list[ParsedReceiptItem]) -> list[receipt_parsing.ParsedLine]:
    lines: list[receipt_parsing.ParsedLine] = []
    for item in items:
        price = _coerce_decimal(item.price)
        if price is None:
            # The one field the AI is expected to always get right for a
            # real line item -- if it still doesn't parse after stripping
            # common formatting, don't guess, just drop it the same way
            # parse_receipt_text() drops lines it can't parse.
            continue
        lines.append(
            receipt_parsing.ParsedLine(
                # No single OCR source line maps cleanly to an AI-extracted
                # item (it may have merged wrapped lines or reworded noise
                # away) -- the cleaned name is the closest useful stand-in
                # for the "what did we detect" context this column exists for.
                raw_line_text=item.name,
                parsed_name=item.name,
                parsed_quantity=_coerce_decimal(item.quantity),
                parsed_unit=item.unit,
                parsed_price=price,
            )
        )
    return lines


def _parse_receipt_lines(raw_text: str) -> list[receipt_parsing.ParsedLine]:
    """AI-first: the configured AiProvider reads the raw OCR text into
    structured line items (name/price guaranteed, quantity/unit
    best-effort), which handles real-world receipt formatting far better
    than the plain regex fallback below. Falls back to the regex parser --
    worse, but still gives the user something to start from -- if the AI
    provider is unreachable, times out, produces output that still doesn't
    parse after its own repair-retry, or (after coercion) yields zero
    usable items, rather than failing the whole session or returning
    nothing over it.
    """
    try:
        ai_items = get_ai_provider().parse_receipt_items(raw_text)
    except AiProviderError as exc:
        _logger.warning(
            "AI receipt parsing failed (%s: %s); falling back to regex parser",
            type(exc).__name__,
            exc,
        )
        return receipt_parsing.parse_receipt_text(raw_text)

    lines = _ai_items_to_parsed_lines(ai_items)
    if not lines and ai_items:
        _logger.warning(
            "AI receipt parsing returned %d item(s) but none survived coercion; "
            "falling back to regex parser",
            len(ai_items),
        )
        return receipt_parsing.parse_receipt_text(raw_text)
    return lines


def process_session(household_id: UUID, session_id: UUID) -> ReceiptImportSessionWithItems:
    client = get_service_client()
    session_result = (
        client.table(_SESSIONS_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .eq("id", str(session_id))
        .maybe_single()
        .execute()
    )
    if not session_result or not session_result.data:
        raise SessionNotFoundError
    if session_result.data["status"] not in ("PENDING", "FAILED"):
        raise InvalidSessionStateError(session_result.data["status"])
    image_path = session_result.data["image_path"]

    client.table(_SESSIONS_TABLE).update({"status": "PROCESSING", "error_message": None}).eq(
        "id", str(session_id)
    ).execute()

    # Broad except is deliberate here: this pipeline calls out to Storage and
    # an external OCR API, either of which can fail in ways we can't fully
    # enumerate (network, quota, malformed image, missing API key). Every
    # failure mode should land the session in a clean FAILED state with a
    # message, never an unhandled 500 -- the user can always retry.
    try:
        image_bytes = client.storage.from_(_BUCKET).download(image_path)
        settings = get_settings()
        ocr_result = run_ocr(image_bytes, mime_type="image/jpeg")
        parsed_lines = _parse_receipt_lines(ocr_result.raw_text or "")

        # A retry re-parses from scratch -- clear whatever a prior failed
        # attempt may have left behind rather than appending to it.
        client.table(_ITEMS_TABLE).delete().eq("session_id", str(session_id)).execute()

        resolved_food_ids = food_definitions_service.resolve_food_ids(
            household_id, [line.parsed_name for line in parsed_lines if line.parsed_name]
        )

        if parsed_lines:
            client.table(_ITEMS_TABLE).insert(
                [
                    {
                        "session_id": str(session_id),
                        "position": i,
                        "raw_line_text": line.raw_line_text,
                        "parsed_name": line.parsed_name,
                        "parsed_quantity": (
                            str(line.parsed_quantity) if line.parsed_quantity is not None else None
                        ),
                        "parsed_unit": line.parsed_unit,
                        "parsed_price": (
                            str(line.parsed_price) if line.parsed_price is not None else None
                        ),
                        # Pre-fill the editable fields from the parsed guess
                        # (plus the resolved food type, when confident) so
                        # the review page starts with sensible defaults
                        # instead of all-blank inputs.
                        "global_food_definition_id": (
                            str(resolved_food_ids[line.parsed_name])
                            if line.parsed_name in resolved_food_ids
                            else None
                        ),
                        "quantity": (
                            str(line.parsed_quantity) if line.parsed_quantity is not None else None
                        ),
                        "preferred_unit": line.parsed_unit,
                        "cost": str(line.parsed_price) if line.parsed_price is not None else None,
                    }
                    for i, line in enumerate(parsed_lines)
                ]
            ).execute()

        client.table(_SESSIONS_TABLE).update(
            {
                "status": "COMPLETED",
                "raw_ocr_text": ocr_result.raw_text,
                "ocr_engine": settings.ocr_engine,
                "processed_at": datetime.now(UTC).isoformat(),
            }
        ).eq("id", str(session_id)).execute()
    except Exception as exc:  # noqa: BLE001
        client.table(_SESSIONS_TABLE).update(
            {"status": "FAILED", "error_message": str(exc)[:1000]}
        ).eq("id", str(session_id)).execute()

    return get_by_id(household_id, session_id)  # type: ignore[return-value]


def update_item(
    household_id: UUID, session_id: UUID, item_id: UUID, body: UpdateReceiptImportItemRequest
) -> ReceiptImportItem:
    session = get_by_id(household_id, session_id)
    if session is None:
        raise SessionNotFoundError
    if session.status != ReceiptImportSessionStatus.COMPLETED:
        raise InvalidSessionStateError(session.status)

    updates = body.model_dump(mode="json", exclude_none=True)
    if not updates:
        item = next((i for i in session.items if i.id == item_id), None)
        if item is None:
            raise ItemNotFoundError
        return item

    client = get_service_client()
    result = (
        client.table(_ITEMS_TABLE)
        .update(updates)
        .eq("session_id", str(session_id))
        .eq("id", str(item_id))
        .execute()
    )
    if not result.data:
        raise ItemNotFoundError

    # Re-fetch enriched (the update response has no embeds), same pattern
    # inventory_items.py uses for its own mutate-then-return-enriched calls.
    enriched = (
        client.table(_ITEMS_TABLE)
        .select(_ENRICHED_ITEM_SELECT)
        .eq("id", str(item_id))
        .single()
        .execute()
    )
    return _flatten_item(enriched.data)


def finalize(
    household_id: UUID, session_id: UUID, member_id: UUID
) -> ReceiptImportSessionWithItems:
    session = get_by_id(household_id, session_id)
    if session is None:
        raise SessionNotFoundError
    if session.status not in (
        ReceiptImportSessionStatus.COMPLETED,
        ReceiptImportSessionStatus.FINALIZED,
    ):
        raise InvalidSessionStateError(session.status)
    if any(item.status == ReceiptImportItemStatus.NEEDS_REVIEW for item in session.items):
        raise FinalizeValidationError("Every item must be confirmed or skipped before finalizing")

    client = get_service_client()

    # Idempotency: finalize is N separate RPC calls, not one transaction --
    # a retry after a partial failure must skip items already imported
    # rather than double-importing them.
    pending_items = [
        item
        for item in session.items
        if item.status == ReceiptImportItemStatus.CONFIRMED
        and item.created_inventory_item_id is None
    ]

    # Batched once up front instead of once per item below -- a receipt
    # with dozens of confirmed lines would otherwise cost a query per item
    # for both of these.
    active_member_ids = inventory_service.list_active_member_ids(household_id)
    accounting_types = inventory_service.resolve_accounting_types(
        [item.global_food_definition_id for item in pending_items if item.accounting_type is None]
    )

    for item in pending_items:
        if (
            not item.global_food_definition_id
            or not item.storage_location_id
            or item.quantity is None
            or item.quantity <= 0
            or not item.preferred_unit
        ):
            raise FinalizeValidationError(f"Item {item.id} is missing required fields")
        if not item.allowed_member_ids:
            raise FinalizeValidationError(f"Item {item.id} has no allowed members")
        # The RPC's own guard only rejects an *empty* array, not a *stale*
        # one -- a member could've been deactivated since this item was
        # confirmed. Re-validate here, same as the manual add-item path does.
        if not set(item.allowed_member_ids) <= active_member_ids:
            raise FinalizeValidationError(f"Item {item.id} has invalid allowed members")

        body = CreateInventoryItemRequest(
            global_food_definition_id=item.global_food_definition_id,
            storage_location_id=item.storage_location_id,
            quantity=item.quantity,
            preferred_unit=item.preferred_unit,
            cost=item.cost or Decimal(0),
            allowed_member_ids=item.allowed_member_ids,
            accounting_type=(
                item.accounting_type or accounting_types.get(item.global_food_definition_id)
            ),
        )
        created = inventory_service.create_manual(
            household_id, member_id, body, receipt_image_path=session.image_path
        )

        client.table(_ITEMS_TABLE).update(
            {"status": "IMPORTED", "created_inventory_item_id": str(created.id)}
        ).eq("id", str(item.id)).execute()

    client.table(_SESSIONS_TABLE).update({"status": "FINALIZED"}).eq(
        "id", str(session_id)
    ).execute()
    return get_by_id(household_id, session_id)  # type: ignore[return-value]
