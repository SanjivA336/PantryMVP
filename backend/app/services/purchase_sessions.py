import logging
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from uuid import UUID, uuid4

from app.core.config import get_settings
from app.core.supabase import get_service_client
from app.schemas.inventory_item import CreateInventoryItemRequest
from app.schemas.purchase_session import (
    CreateReceiptSessionResponse,
    ParsedReceiptItem,
    PurchaseSession,
    PurchaseSessionItem,
    PurchaseSessionItemStatus,
    PurchaseSessionStatus,
    PurchaseSessionWithItems,
    UpdatePurchaseSessionItemRequest,
)
from app.schemas.units import coerce_unit_from_ai
from app.services import food_definitions as food_definitions_service
from app.services import inventory_items as inventory_service
from app.services import receipt_parsing
from app.services.ai import get_ai_provider
from app.services.ai.base import AiProviderError
from app.services.receipt_ocr import run_ocr

_SESSIONS_TABLE = "purchase_sessions"
_ITEMS_TABLE = "purchase_session_items"
_SHOPPING_ITEMS_TABLE = "shopping_list_items"
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


class NothingToBuyError(Exception):
    """No shopping-list items are marked collected -- there's nothing to
    start a purchase session from."""


def _flatten_item(row: dict) -> PurchaseSessionItem:
    food = row.pop("global_food_definitions", None) or {}
    storage = row.pop("storage_locations", None) or {}
    row["food_name"] = food.get("name")
    row["category"] = food.get("category")
    row["storage_location_name"] = storage.get("name")
    return PurchaseSessionItem(**row)


# =========================================================================
# RECEIPT_SCAN entry point (upload a photo, OCR it)
# =========================================================================


def create_receipt_session(
    household_id: UUID, member_id: UUID, filename: str | None
) -> CreateReceiptSessionResponse:
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
            "source": "RECEIPT_SCAN",
            "status": "PENDING",
            "image_path": upload_path,
        }
    ).execute()

    return CreateReceiptSessionResponse(
        id=session_id, upload_bucket=_BUCKET, upload_path=upload_path
    )


# =========================================================================
# SHOPPING_LIST entry point ("bought marked items")
# =========================================================================


def create_from_shopping_list(household_id: UUID, member_id: UUID) -> PurchaseSessionWithItems:
    """Start a purchase session from every collected shopping-list item, and
    remove those items from the list right away -- so two people can't both
    seed a session off the same items."""
    client = get_service_client()
    collected = (
        client.table(_SHOPPING_ITEMS_TABLE)
        .select("id, name, household_food_variant_id")
        .eq("household_id", str(household_id))
        .eq("status", "ACTIVE")
        .eq("collected", True)
        .order("sort_order")
        .execute()
    ).data
    if not collected:
        raise NothingToBuyError

    variant_ids = [
        row["household_food_variant_id"] for row in collected if row["household_food_variant_id"]
    ]
    food_id_by_variant: dict[str, str] = {}
    if variant_ids:
        variants = (
            client.table("household_food_variants")
            .select("id, global_food_definition_id")
            .in_("id", variant_ids)
            .execute()
        ).data
        food_id_by_variant = {
            v["id"]: v["global_food_definition_id"]
            for v in variants
            if v["global_food_definition_id"]
        }

    session_id = uuid4()
    client.table(_SESSIONS_TABLE).insert(
        {
            "id": str(session_id),
            "household_id": str(household_id),
            "created_by_member_id": str(member_id),
            "source": "SHOPPING_LIST",
            "status": "PENDING",
        }
    ).execute()

    client.table(_ITEMS_TABLE).insert(
        [
            {
                "session_id": str(session_id),
                "position": i,
                "raw_line_text": row["name"],
                "shopping_list_item_id": row["id"],
                "global_food_definition_id": food_id_by_variant.get(
                    row["household_food_variant_id"]
                ),
            }
            for i, row in enumerate(collected)
        ]
    ).execute()

    # Off the list immediately -- see the docstring.
    client.table(_SHOPPING_ITEMS_TABLE).update(
        {"status": "REMOVED", "removed_at": datetime.now(UTC).isoformat()}
    ).eq("household_id", str(household_id)).in_("id", [row["id"] for row in collected]).execute()

    return get_by_id(household_id, session_id)  # type: ignore[return-value]


def delete_session(household_id: UUID, session_id: UUID) -> None:
    """Delete a not-yet-finalized session (and its lines, via cascade). A
    FINALIZED session created real inventory items and can't be unwound
    here -- correct or discard those items individually instead."""
    client = get_service_client()
    existing = (
        client.table(_SESSIONS_TABLE)
        .select("status")
        .eq("household_id", str(household_id))
        .eq("id", str(session_id))
        .maybe_single()
        .execute()
    )
    if not existing or not existing.data:
        raise SessionNotFoundError
    if existing.data["status"] == "FINALIZED":
        raise InvalidSessionStateError("FINALIZED")

    client.table(_SESSIONS_TABLE).delete().eq("household_id", str(household_id)).eq(
        "id", str(session_id)
    ).execute()


# =========================================================================
# Shared: read / list
# =========================================================================


def list_for_household(
    household_id: UUID, source: str | None = None, status: str | None = None
) -> list[PurchaseSession]:
    client = get_service_client()
    query = client.table(_SESSIONS_TABLE).select("*").eq("household_id", str(household_id))
    if source:
        query = query.eq("source", source)
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).execute()
    return [PurchaseSession(**row) for row in result.data]


def get_by_id(household_id: UUID, session_id: UUID) -> PurchaseSessionWithItems | None:
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
    return PurchaseSessionWithItems(**session_result.data, items=items)


# =========================================================================
# RECEIPT_SCAN: OCR pipeline
# =========================================================================


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
            continue
        lines.append(
            receipt_parsing.ParsedLine(
                raw_line_text=item.name,
                parsed_name=item.name,
                parsed_quantity=_coerce_decimal(item.quantity),
                parsed_unit=item.unit,
                preferred_unit=coerce_unit_from_ai(item.unit),
                parsed_price=price,
            )
        )
    return lines


def _parse_receipt_lines(raw_text: str) -> list[receipt_parsing.ParsedLine]:
    """AI-first: the configured AiProvider reads the raw OCR text into
    structured line items, falling back to the regex parser if the AI
    provider is unreachable, times out, produces unparseable output, or
    (after coercion) yields zero usable items.
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


def process_session(household_id: UUID, session_id: UUID) -> PurchaseSessionWithItems:
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
    if session_result.data["source"] != "RECEIPT_SCAN":
        raise InvalidSessionStateError("not a receipt-scan session")
    if session_result.data["status"] not in ("PENDING", "FAILED"):
        raise InvalidSessionStateError(session_result.data["status"])
    image_path = session_result.data["image_path"]

    client.table(_SESSIONS_TABLE).update({"status": "PROCESSING", "error_message": None}).eq(
        "id", str(session_id)
    ).execute()

    try:
        image_bytes = client.storage.from_(_BUCKET).download(image_path)
        settings = get_settings()
        ocr_result = run_ocr(image_bytes, mime_type="image/jpeg")
        parsed_lines = _parse_receipt_lines(ocr_result.raw_text or "")

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
                        "global_food_definition_id": (
                            str(resolved_food_ids[line.parsed_name])
                            if line.parsed_name in resolved_food_ids
                            else None
                        ),
                        "quantity": (
                            str(line.parsed_quantity) if line.parsed_quantity is not None else None
                        ),
                        "preferred_unit": (
                            line.preferred_unit.value if line.preferred_unit is not None else None
                        ),
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


# =========================================================================
# Shared: per-line edit + finalize
# =========================================================================

# The state in which a session's lines are open for editing, per source.
_EDITABLE_STATUS = {
    "RECEIPT_SCAN": PurchaseSessionStatus.COMPLETED,
    "SHOPPING_LIST": PurchaseSessionStatus.PENDING,
}


def update_item(
    household_id: UUID, session_id: UUID, item_id: UUID, body: UpdatePurchaseSessionItemRequest
) -> PurchaseSessionItem:
    session = get_by_id(household_id, session_id)
    if session is None:
        raise SessionNotFoundError
    if session.status != _EDITABLE_STATUS[session.source]:
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

    enriched = (
        client.table(_ITEMS_TABLE)
        .select(_ENRICHED_ITEM_SELECT)
        .eq("id", str(item_id))
        .single()
        .execute()
    )
    return _flatten_item(enriched.data)


def remove_item(household_id: UUID, session_id: UUID, item_id: UUID) -> None:
    """Drop a line from an open session entirely. (A SHOPPING_LIST line's
    source item was already removed from the list at session creation, so
    there's nothing to restore.)"""
    session = get_by_id(household_id, session_id)
    if session is None:
        raise SessionNotFoundError
    if session.status != _EDITABLE_STATUS[session.source]:
        raise InvalidSessionStateError(session.status)
    client = get_service_client()
    client.table(_ITEMS_TABLE).delete().eq("session_id", str(session_id)).eq(
        "id", str(item_id)
    ).execute()


def add_blank_item(household_id: UUID, session_id: UUID) -> PurchaseSessionItem:
    """Append an empty PENDING line to an open session -- the wizard's
    "add item to order"."""
    session = get_by_id(household_id, session_id)
    if session is None:
        raise SessionNotFoundError
    if session.status != _EDITABLE_STATUS[session.source]:
        raise InvalidSessionStateError(session.status)
    next_position = max((i.position for i in session.items), default=-1) + 1
    client = get_service_client()
    inserted = (
        client.table(_ITEMS_TABLE)
        .insert(
            {
                "session_id": str(session_id),
                "position": next_position,
                "raw_line_text": "",
            }
        )
        .execute()
    )
    enriched = (
        client.table(_ITEMS_TABLE)
        .select(_ENRICHED_ITEM_SELECT)
        .eq("id", inserted.data[0]["id"])
        .single()
        .execute()
    )
    return _flatten_item(enriched.data)


def finalize(
    household_id: UUID, session_id: UUID, finalized_by_member_id: UUID
) -> PurchaseSessionWithItems:
    session = get_by_id(household_id, session_id)
    if session is None:
        raise SessionNotFoundError
    if session.status not in (
        _EDITABLE_STATUS[session.source],
        PurchaseSessionStatus.FINALIZED,
    ):
        raise InvalidSessionStateError(session.status)
    if any(item.status == PurchaseSessionItemStatus.PENDING for item in session.items):
        raise FinalizeValidationError("Every line must be marked complete before finalizing")

    client = get_service_client()

    # Idempotency: finalize is N separate RPC calls, not one transaction --
    # a retry after a partial failure skips lines already imported.
    pending_items = [
        item
        for item in session.items
        if item.status == PurchaseSessionItemStatus.COMPLETE
        and item.created_inventory_item_id is None
    ]

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
        # Per-line buyer, falling back to whoever created the session (not
        # the finalizer -- they may differ).
        buyer_id = item.buyer_member_id or session.created_by_member_id
        created = inventory_service.create_manual(
            household_id, buyer_id, body, receipt_image_path=session.image_path
        )
        _ = finalized_by_member_id  # reserved for an audit trail later

        client.table(_ITEMS_TABLE).update(
            {"status": "IMPORTED", "created_inventory_item_id": str(created.id)}
        ).eq("id", str(item.id)).execute()

    client.table(_SESSIONS_TABLE).update({"status": "FINALIZED"}).eq(
        "id", str(session_id)
    ).execute()
    return get_by_id(household_id, session_id)  # type: ignore[return-value]
