from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.inventory_item import CreateInventoryItemRequest, InventoryItem, RemovalReason

_TABLE = "inventory_items"

# Embeds the food name (via the household's variant -> global definition)
# and storage location name in one query, so the frontend never has to
# stitch together multiple lookups just to show "Whole Milk" instead of a
# food_definition UUID.
_ENRICHED_SELECT = (
    "*, household_food_variants(name_override, global_food_definitions(name)), "
    "storage_locations(name)"
)


class InsufficientQuantityError(Exception):
    pass


def _flatten(row: dict) -> InventoryItem:
    variant = row.pop("household_food_variants", None) or {}
    storage = row.pop("storage_locations", None) or {}
    global_definition = variant.get("global_food_definitions") or {}

    row["food_name"] = (
        variant.get("name_override") or global_definition.get("name") or "Unknown food"
    )
    row["storage_location_name"] = storage.get("name") or "Unknown location"

    return InventoryItem(**row)


def create_manual(
    household_id: UUID, member_id: UUID, body: CreateInventoryItemRequest
) -> InventoryItem:
    client = get_service_client()
    rpc_result = client.rpc(
        "create_manual_inventory_item",
        {
            "p_household_id": str(household_id),
            "p_member_id": str(member_id),
            "p_global_food_definition_id": str(body.global_food_definition_id),
            "p_storage_location_id": str(body.storage_location_id),
            "p_quantity": str(body.quantity),
            "p_preferred_unit": body.preferred_unit,
            "p_cost": str(body.cost),
            "p_expiry_date": body.expiry_date.isoformat() if body.expiry_date else None,
            "p_best_by_date": body.best_by_date.isoformat() if body.best_by_date else None,
            "p_allowed_member_ids": [str(m) for m in body.allowed_member_ids],
        },
    ).execute()
    new_item_id = (
        rpc_result.data[0]["id"] if isinstance(rpc_result.data, list) else rpc_result.data["id"]
    )
    # The RPC returns a bare inventory_items row (no embedding support for
    # composite-returning functions) — re-fetch enriched for a uniform shape.
    return get_by_id(household_id, UUID(new_item_id))  # type: ignore[return-value]


def list_for_household(household_id: UUID, status: str | None = None) -> list[InventoryItem]:
    client = get_service_client()
    query = client.table(_TABLE).select(_ENRICHED_SELECT).eq("household_id", str(household_id))
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).execute()
    return [_flatten(row) for row in result.data]


def get_by_id(household_id: UUID, item_id: UUID) -> InventoryItem | None:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select(_ENRICHED_SELECT)
        .eq("household_id", str(household_id))
        .eq("id", str(item_id))
        .maybe_single()
        .execute()
    )
    return _flatten(result.data) if result and result.data else None


def consume(
    household_id: UUID, member_id: UUID, item_id: UUID, quantity_used: Decimal
) -> InventoryItem:
    client = get_service_client()
    try:
        client.rpc(
            "consume_inventory_item",
            {
                "p_household_id": str(household_id),
                "p_member_id": str(member_id),
                "p_inventory_item_id": str(item_id),
                "p_quantity_used": str(quantity_used),
            },
        ).execute()
    except APIError as exc:
        if "INSUFFICIENT_QUANTITY" in str(exc):
            raise InsufficientQuantityError from exc
        raise
    return get_by_id(household_id, item_id)  # type: ignore[return-value]


def discard(household_id: UUID, item_id: UUID, reason: RemovalReason) -> InventoryItem:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .update({"status": reason.value})
        .eq("household_id", str(household_id))
        .eq("id", str(item_id))
        .eq("status", "ACTIVE")
        .execute()
    )
    if not result.data:
        raise ValueError("Item not found or not currently active")
    return get_by_id(household_id, item_id)  # type: ignore[return-value]


def allowed_member_ids_are_valid(household_id: UUID, member_ids: list[UUID]) -> bool:
    """All given member ids must be active members of this household."""
    client = get_service_client()
    result = (
        client.table("members")
        .select("id")
        .eq("household_id", str(household_id))
        .eq("is_active", True)
        .in_("id", [str(m) for m in member_ids])
        .execute()
    )
    return len(result.data) == len(set(member_ids))
