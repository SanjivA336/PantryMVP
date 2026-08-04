from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.inventory_item import InventoryItem
from app.schemas.warning import (
    ExpiryWarning,
    ExpiryWarningType,
    HouseholdWarnings,
    StockWarning,
    StockWarningType,
)
from app.services import inventory_items as inventory_service

_STOCK_IGNORES_TABLE = "stock_warning_ignores"
_EXPIRY_IGNORES_TABLE = "expiry_warning_ignores"

# How many days out counts as "expiring soon" -- a plain constant rather than
# a per-household setting, since nothing in this MVP needs it configurable
# yet.
EXPIRY_WARNING_DAYS = 3

# A food is "low stock" once what's left drops below this fraction of the
# most recent purchase's size. Relative rather than a fixed configured
# threshold -- no schema/UI changes needed, at the cost of being an arbitrary
# cutoff that won't fit every household's buying habits equally well.
LOW_STOCK_FRACTION = Decimal("0.2")


def _relevant_expiry_date(expiry_date: date | None, best_by_date: date | None) -> date | None:
    dates = [d for d in (expiry_date, best_by_date) if d is not None]
    return min(dates) if dates else None


# Split out from compute_warnings() so unit tests can monkeypatch these two
# lookups alone (same pattern as the existing list_for_household monkeypatch)
# instead of needing a real Supabase client just to exercise the pure
# expiry/stock computation logic.
def _fetch_ignored_expiry_item_ids(household_id: UUID) -> set[UUID]:
    client = get_service_client()
    rows = (
        client.table(_EXPIRY_IGNORES_TABLE)
        .select("inventory_item_id")
        .eq("household_id", str(household_id))
        .execute()
        .data
    )
    return {UUID(row["inventory_item_id"]) for row in rows}


def _fetch_ignored_stock_references(household_id: UUID) -> dict[UUID, datetime]:
    client = get_service_client()
    rows = (
        client.table(_STOCK_IGNORES_TABLE)
        .select("household_food_variant_id, reference_purchased_at")
        .eq("household_id", str(household_id))
        .execute()
        .data
    )
    return {
        UUID(row["household_food_variant_id"]): datetime.fromisoformat(
            row["reference_purchased_at"]
        )
        for row in rows
    }


def compute_warnings(household_id: UUID) -> HouseholdWarnings:
    # Unfiltered status: EMPTY/DISCARDED/etc. items still count as the most
    # recent purchase for a food's stock baseline, even though only ACTIVE
    # items count toward what's currently on hand.
    items = inventory_service.list_for_household(household_id)
    ignored_expiry_item_ids = _fetch_ignored_expiry_item_ids(household_id)
    ignored_stock_references = _fetch_ignored_stock_references(household_id)

    today = date.today()
    expiry_warnings: list[ExpiryWarning] = []
    for item in items:
        if item.status != "ACTIVE":
            continue
        if item.id in ignored_expiry_item_ids:
            continue
        relevant_date = _relevant_expiry_date(item.expiry_date, item.best_by_date)
        if relevant_date is None:
            continue
        days_until = (relevant_date - today).days
        if days_until < 0:
            warning_type = ExpiryWarningType.EXPIRED
        elif days_until <= EXPIRY_WARNING_DAYS:
            warning_type = ExpiryWarningType.EXPIRING_SOON
        else:
            continue
        expiry_warnings.append(
            ExpiryWarning(
                type=warning_type,
                inventory_item_id=item.id,
                food_name=item.food_name,
                storage_location_name=item.storage_location_name,
                relevant_date=relevant_date,
                days_until=days_until,
            )
        )

    by_variant: dict[UUID, list[InventoryItem]] = {}
    for item in items:
        by_variant.setdefault(item.household_food_variant_id, []).append(item)

    stock_warnings: list[StockWarning] = []
    for variant_id, variant_items in by_variant.items():
        active_quantity = sum(
            (i.quantity for i in variant_items if i.status == "ACTIVE"), Decimal(0)
        )
        most_recent = max(variant_items, key=lambda i: i.purchased_at)
        reference_quantity = most_recent.total_quantity

        if active_quantity == 0:
            warning_type = StockWarningType.OUT_OF_STOCK
        elif reference_quantity > 0 and active_quantity < reference_quantity * LOW_STOCK_FRACTION:
            warning_type = StockWarningType.LOW_STOCK
        else:
            continue

        ignored_reference = ignored_stock_references.get(variant_id)
        if ignored_reference is not None and ignored_reference == most_recent.purchased_at:
            continue

        stock_warnings.append(
            StockWarning(
                type=warning_type,
                household_food_variant_id=variant_id,
                food_name=most_recent.food_name,
                preferred_unit=most_recent.preferred_unit,
                remaining_quantity=active_quantity,
                reference_quantity=reference_quantity,
                reference_purchased_at=most_recent.purchased_at,
            )
        )

    return HouseholdWarnings(expiry_warnings=expiry_warnings, stock_warnings=stock_warnings)


def ignore_expiry_warning(household_id: UUID, inventory_item_id: UUID) -> None:
    client = get_service_client()
    client.table(_EXPIRY_IGNORES_TABLE).upsert(
        {
            "household_id": str(household_id),
            "inventory_item_id": str(inventory_item_id),
        }
    ).execute()


def ignore_stock_warning(household_id: UUID, household_food_variant_id: UUID) -> None:
    """Ignores the warning as computed *right now* -- keyed to today's
    reference purchase, not the variant alone, so a later restock (which
    changes reference_purchased_at) naturally un-suppresses it again without
    an explicit "unignore" action or a cleanup job.

    Scoped to just this variant's items via list_for_household's filter,
    rather than compute_warnings()'s full household recompute, since this
    only ever needs one variant's current signal.
    """
    variant_items = inventory_service.list_for_household(
        household_id, household_food_variant_id=household_food_variant_id
    )
    if not variant_items:
        return

    active_quantity = sum((i.quantity for i in variant_items if i.status == "ACTIVE"), Decimal(0))
    most_recent = max(variant_items, key=lambda i: i.purchased_at)
    reference_quantity = most_recent.total_quantity

    is_out_of_stock = active_quantity == 0
    is_low_stock = (
        not is_out_of_stock
        and reference_quantity > 0
        and active_quantity < reference_quantity * LOW_STOCK_FRACTION
    )
    if not is_out_of_stock and not is_low_stock:
        return

    client = get_service_client()
    client.table(_STOCK_IGNORES_TABLE).upsert(
        {
            "household_id": str(household_id),
            "household_food_variant_id": str(household_food_variant_id),
            "reference_purchased_at": most_recent.purchased_at.isoformat(),
        }
    ).execute()
