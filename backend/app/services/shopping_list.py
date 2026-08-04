from datetime import UTC, datetime
from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.shopping_list import (
    CreateShoppingListItemRequest,
    ShoppingListItem,
    ShoppingListSection,
)
from app.services import warnings as warnings_service

_SECTIONS_TABLE = "shopping_list_sections"
_ITEMS_TABLE = "shopping_list_items"
_IGNORED_TABLE = "shopping_list_ignored_variants"


class FoodDefinitionNotFoundError(Exception):
    pass


def _next_sort_order(client, table: str, filters: dict[str, str]) -> int:
    query = client.table(table).select("sort_order")
    for column, value in filters.items():
        query = query.eq(column, value)
    result = query.order("sort_order", desc=True).limit(1).execute()
    return (result.data[0]["sort_order"] + 1) if result.data else 0


def _next_item_sort_order(client, household_id: str, section_id: str | None) -> int:
    # A plain .eq("section_id", None) filters for nothing (Postgrest has no
    # way to express "IS NULL" through .eq()), so the unsectioned bucket
    # needs its own .is_() branch -- otherwise every unsectioned item would
    # get compared against the *whole household's* max sort_order instead of
    # just its own bucket's.
    query = client.table(_ITEMS_TABLE).select("sort_order").eq("household_id", household_id)
    query = query.eq("section_id", section_id) if section_id else query.is_("section_id", "null")
    result = query.order("sort_order", desc=True).limit(1).execute()
    return (result.data[0]["sort_order"] + 1) if result.data else 0


def list_sections(household_id: UUID) -> list[ShoppingListSection]:
    client = get_service_client()
    result = (
        client.table(_SECTIONS_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .order("sort_order")
        .execute()
    )
    return [ShoppingListSection(**row) for row in result.data]


def create_section(household_id: UUID, name: str) -> ShoppingListSection:
    client = get_service_client()
    sort_order = _next_sort_order(client, _SECTIONS_TABLE, {"household_id": str(household_id)})
    result = (
        client.table(_SECTIONS_TABLE)
        .insert({"household_id": str(household_id), "name": name, "sort_order": sort_order})
        .execute()
    )
    return ShoppingListSection(**result.data[0])


def update_section(
    household_id: UUID, section_id: UUID, updates: dict
) -> ShoppingListSection | None:
    client = get_service_client()
    # An empty update dict would otherwise reach PostgREST as a no-op write
    # that matches no row, making an existing section look like a 404.
    if not updates:
        result = (
            client.table(_SECTIONS_TABLE)
            .select("*")
            .eq("household_id", str(household_id))
            .eq("id", str(section_id))
            .maybe_single()
            .execute()
        )
        return ShoppingListSection(**result.data) if result and result.data else None
    result = (
        client.table(_SECTIONS_TABLE)
        .update(updates)
        .eq("household_id", str(household_id))
        .eq("id", str(section_id))
        .execute()
    )
    return ShoppingListSection(**result.data[0]) if result.data else None


def delete_section(household_id: UUID, section_id: UUID) -> bool:
    client = get_service_client()
    result = (
        client.table(_SECTIONS_TABLE)
        .delete()
        .eq("household_id", str(household_id))
        .eq("id", str(section_id))
        .execute()
    )
    return bool(result.data)


def list_items(household_id: UUID, status: str | None = "ACTIVE") -> list[ShoppingListItem]:
    client = get_service_client()
    query = client.table(_ITEMS_TABLE).select("*").eq("household_id", str(household_id))
    if status:
        query = query.eq("status", status)
    result = query.order("sort_order").execute()
    return [ShoppingListItem(**row) for row in result.data]


def create_manual_item(
    household_id: UUID, member_id: UUID, body: CreateShoppingListItemRequest
) -> ShoppingListItem:
    client = get_service_client()
    try:
        food = (
            client.table("global_food_definitions")
            .select("name")
            .eq("id", str(body.global_food_definition_id))
            .single()
            .execute()
        )
    except APIError as exc:
        raise FoodDefinitionNotFoundError from exc
    variant_result = client.rpc(
        "find_or_create_household_food_variant",
        {
            "p_household_id": str(household_id),
            "p_global_food_definition_id": str(body.global_food_definition_id),
        },
    ).execute()
    variant_id = variant_result.data

    sort_order = _next_item_sort_order(
        client, str(household_id), str(body.section_id) if body.section_id else None
    )

    result = (
        client.table(_ITEMS_TABLE)
        .insert(
            {
                "household_id": str(household_id),
                "section_id": str(body.section_id) if body.section_id else None,
                "name": food.data["name"],
                "household_food_variant_id": variant_id,
                "source": "MANUAL",
                "added_by_member_id": str(member_id),
                "sort_order": sort_order,
            }
        )
        .execute()
    )
    return ShoppingListItem(**result.data[0])


def update_item(household_id: UUID, item_id: UUID, updates: dict) -> ShoppingListItem | None:
    client = get_service_client()
    payload = {**updates}
    if "section_id" in payload:
        payload["section_id"] = str(payload["section_id"]) if payload["section_id"] else None
    result = (
        client.table(_ITEMS_TABLE)
        .update(payload)
        .eq("household_id", str(household_id))
        .eq("id", str(item_id))
        .execute()
    )
    return ShoppingListItem(**result.data[0]) if result.data else None


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


def clear_items(household_id: UUID) -> None:
    """Soft-removes every currently-ACTIVE item, same as remove_item but for
    the whole list at once -- sections are untouched, this only empties them
    out."""
    client = get_service_client()
    client.table(_ITEMS_TABLE).update(
        {"status": "REMOVED", "removed_at": datetime.now(UTC).isoformat()}
    ).eq("household_id", str(household_id)).eq("status", "ACTIVE").execute()


def ignore_variant_permanently(household_id: UUID, household_food_variant_id: UUID) -> None:
    client = get_service_client()
    client.table(_IGNORED_TABLE).upsert(
        {
            "household_id": str(household_id),
            "household_food_variant_id": str(household_food_variant_id),
        }
    ).execute()


def suggest_items(household_id: UUID, member_id: UUID) -> list[ShoppingListItem]:
    """Proposes shopping-list items from the warnings layer's current stock
    signals. Skips foods already ACTIVE on the list, foods permanently
    ignored (shopping_list_ignored_variants), and foods dismissed (removed
    as a SUGGESTED item) since their last purchase -- see the
    household_food_variant_id / reference_purchased_at comparison below,
    which is how a later restock makes a food eligible to be suggested
    again after being dismissed once.
    """
    warnings = warnings_service.compute_warnings(household_id)
    candidates = {w.household_food_variant_id: w for w in warnings.stock_warnings}
    if not candidates:
        return []

    client = get_service_client()
    ignored = (
        client.table(_IGNORED_TABLE)
        .select("household_food_variant_id")
        .eq("household_id", str(household_id))
        .in_("household_food_variant_id", [str(v) for v in candidates])
        .execute()
    )
    ignored_variant_ids = {UUID(row["household_food_variant_id"]) for row in ignored.data}

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

    sort_order = _next_item_sort_order(client, str(household_id), None)
    to_insert = []
    for variant_id, warning in candidates.items():
        if variant_id in active_variant_ids or variant_id in ignored_variant_ids:
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
                "sort_order": sort_order,
            }
        )
        sort_order += 1

    if not to_insert:
        return []

    result = client.table(_ITEMS_TABLE).insert(to_insert).execute()
    return [ShoppingListItem(**row) for row in result.data]
