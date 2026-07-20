from datetime import UTC, datetime
from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.shopping_list import (
    CreateShoppingListItemRequest,
    ShoppingListItem,
    ShoppingListSection,
)
from app.services import warnings as warnings_service

_SECTIONS_TABLE = "shopping_list_sections"
_ITEMS_TABLE = "shopping_list_items"


def list_sections(household_id: UUID) -> list[ShoppingListSection]:
    client = get_service_client()
    result = (
        client.table(_SECTIONS_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .order("created_at")
        .execute()
    )
    return [ShoppingListSection(**row) for row in result.data]


def create_section(household_id: UUID, name: str) -> ShoppingListSection:
    client = get_service_client()
    result = (
        client.table(_SECTIONS_TABLE)
        .insert({"household_id": str(household_id), "name": name})
        .execute()
    )
    return ShoppingListSection(**result.data[0])


def delete_section(household_id: UUID, section_id: UUID) -> None:
    client = get_service_client()
    client.table(_SECTIONS_TABLE).delete().eq("household_id", str(household_id)).eq(
        "id", str(section_id)
    ).execute()


def list_items(household_id: UUID, status: str | None = "ACTIVE") -> list[ShoppingListItem]:
    client = get_service_client()
    query = client.table(_ITEMS_TABLE).select("*").eq("household_id", str(household_id))
    if status:
        query = query.eq("status", status)
    result = query.order("created_at").execute()
    return [ShoppingListItem(**row) for row in result.data]


def create_manual_item(
    household_id: UUID, member_id: UUID, body: CreateShoppingListItemRequest
) -> ShoppingListItem:
    client = get_service_client()
    result = (
        client.table(_ITEMS_TABLE)
        .insert(
            {
                "household_id": str(household_id),
                "section_id": str(body.section_id) if body.section_id else None,
                "name": body.name,
                "source": "MANUAL",
                "added_by_member_id": str(member_id),
            }
        )
        .execute()
    )
    return ShoppingListItem(**result.data[0])


def remove_item(household_id: UUID, item_id: UUID) -> ShoppingListItem:
    client = get_service_client()
    result = (
        client.table(_ITEMS_TABLE)
        .update({"status": "REMOVED", "removed_at": datetime.now(UTC).isoformat()})
        .eq("household_id", str(household_id))
        .eq("id", str(item_id))
        .eq("status", "ACTIVE")
        .execute()
    )
    if not result.data:
        raise ValueError("Item not found or not currently active")
    return ShoppingListItem(**result.data[0])


def suggest_items(household_id: UUID, member_id: UUID) -> list[ShoppingListItem]:
    """Proposes shopping-list items from the warnings layer's current stock
    signals. Skips foods already ACTIVE on the list, and foods dismissed
    (removed as a SUGGESTED item) since their last purchase -- see the
    household_food_variant_id / reference_purchased_at comparison below,
    which is how a later restock makes a food eligible to be suggested
    again after being dismissed once.
    """
    warnings = warnings_service.compute_warnings(household_id)
    candidates = {w.household_food_variant_id: w for w in warnings.stock_warnings}
    if not candidates:
        return []

    client = get_service_client()
    existing = (
        client.table(_ITEMS_TABLE)
        .select("household_food_variant_id, status, removed_at")
        .eq("household_id", str(household_id))
        .in_("household_food_variant_id", [str(v) for v in candidates])
        .execute()
    )

    active_variant_ids: set[UUID] = set()
    latest_removed_at: dict[UUID, datetime] = {}
    for row in existing.data:
        variant_id = UUID(row["household_food_variant_id"])
        if row["status"] == "ACTIVE":
            active_variant_ids.add(variant_id)
        elif row["status"] == "REMOVED" and row["removed_at"]:
            removed_at = datetime.fromisoformat(row["removed_at"])
            if variant_id not in latest_removed_at or removed_at > latest_removed_at[variant_id]:
                latest_removed_at[variant_id] = removed_at

    to_insert = []
    for variant_id, warning in candidates.items():
        if variant_id in active_variant_ids:
            continue
        dismissed_at = latest_removed_at.get(variant_id)
        if dismissed_at and dismissed_at >= warning.reference_purchased_at:
            continue
        to_insert.append(
            {
                "household_id": str(household_id),
                "household_food_variant_id": str(variant_id),
                "name": warning.food_name,
                "source": "SUGGESTED",
                "added_by_member_id": str(member_id),
            }
        )

    if not to_insert:
        return []

    result = client.table(_ITEMS_TABLE).insert(to_insert).execute()
    return [ShoppingListItem(**row) for row in result.data]
