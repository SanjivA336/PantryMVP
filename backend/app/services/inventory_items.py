from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.food_definition import AccountingType
from app.schemas.inventory_item import (
    CorrectInventoryItemRequest,
    CreateInventoryItemRequest,
    InventoryItem,
    PurchaseCorrection,
    RemovalReason,
    UpdateInventoryItemRequest,
)
from app.schemas.units import Dimension, MeasurementPreference, UnitSystem
from app.services import accounting as accounting_service
from app.services import food_definitions as food_definitions_service
from app.services import households as households_service
from app.services import units as units_service

_TABLE = "inventory_items"

# Embeds the food name (via the household's variant -> global definition),
# storage location name, and the current allowed-members roster in one
# query, so the frontend never has to stitch together multiple lookups just
# to show "Whole Milk" / "Garage Fridge" / who can use this.
_ENRICHED_SELECT = (
    "*, household_food_variants(global_food_definitions(name, category)), "
    "storage_locations(name), inventory_item_allowed_members(member_id)"
)


class InsufficientQuantityError(Exception):
    pass


class MemberNotAllowedError(Exception):
    pass


class FoodDefinitionNotFoundError(Exception):
    pass


class ItemNotFoundError(Exception):
    pass


class ItemFrozenError(Exception):
    """Raised when a caller tries to directly edit cost, total_quantity, or
    allowed_member_ids on an item whose debt has already frozen -- real
    ledger_entries exist by then, so those three need a correction
    (correct_item) instead of a plain edit."""

    pass


class ItemNotFrozenError(Exception):
    """The inverse of ItemFrozenError -- corrections only make sense once
    there's something real to correct. While an item is still live, use
    update_item directly instead."""

    pass


class UnitDimensionMismatchError(Exception):
    """Raised when a preferred_unit edit would change the item's dimension
    (weight/volume/count) -- only a same-dimension system swap (e.g. oz -> g)
    is allowed; that's tied to the food type, which isn't editable here."""

    pass


def _flatten(row: dict) -> InventoryItem:
    variant = row.pop("household_food_variants", None) or {}
    storage = row.pop("storage_locations", None) or {}
    allowed = row.pop("inventory_item_allowed_members", None) or []
    global_definition = variant.get("global_food_definitions") or {}

    # This item's own label wins over the food's name -- two jugs of the
    # same food definition can be told apart ("HEB milk" vs "Costco milk")
    # without needing separate variants or losing the shared running total.
    row["food_name"] = row.get("name_override") or global_definition.get("name") or "Unknown food"
    row["food_type_name"] = global_definition.get("name") or "Unknown food"
    row["category"] = global_definition.get("category")
    row["storage_location_name"] = storage.get("name") or "Unknown location"
    row["allowed_member_ids"] = [a["member_id"] for a in allowed]

    return InventoryItem(**row)


def _resolve_accounting_type(body: CreateInventoryItemRequest) -> AccountingType:
    if body.accounting_type is not None:
        return body.accounting_type
    client = get_service_client()
    try:
        result = (
            client.table("global_food_definitions")
            .select("accounting_type_default")
            .eq("id", str(body.global_food_definition_id))
            .single()
            .execute()
        )
    except APIError as exc:
        raise FoodDefinitionNotFoundError from exc
    return AccountingType(result.data["accounting_type_default"])


def create_manual(
    household_id: UUID,
    member_id: UUID,
    body: CreateInventoryItemRequest,
    receipt_image_path: str | None = None,
) -> InventoryItem:
    accounting_type = _resolve_accounting_type(body)
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
            "p_accounting_type": accounting_type.value,
            "p_receipt_image_path": receipt_image_path,
            "p_name_override": body.name_override,
        },
    ).execute()
    new_item_id = (
        rpc_result.data[0]["id"] if isinstance(rpc_result.data, list) else rpc_result.data["id"]
    )
    # The RPC returns a bare inventory_items row (no embedding support for
    # composite-returning functions) — re-fetch enriched for a uniform shape.
    item = get_by_id(household_id, UUID(new_item_id))
    assert item is not None
    _remember_measurement_choice(item.household_food_variant_id, body.preferred_unit)
    return item


def resolve_measurement_preference(
    household_id: UUID, global_food_definition_id: UUID
) -> MeasurementPreference:
    """What unit the Add Item form should default to for this food, in this
    household. A dimension/system this household already chose for this food
    (see _remember_measurement_choice) always wins; otherwise falls back to
    the food's usual kind of measurement (weight/volume/count, guessed from
    the catalog's own preferred_unit) combined with the household's
    metric/customary default -- not the catalog's own unit system, since the
    household default exists specifically for foods it hasn't tracked yet.
    """
    client = get_service_client()
    variant_result = (
        client.table("household_food_variants")
        .select("dimension, unit_system")
        .eq("household_id", str(household_id))
        .eq("global_food_definition_id", str(global_food_definition_id))
        .maybe_single()
        .execute()
    )
    variant = variant_result.data if variant_result and variant_result.data else None
    if variant and variant.get("dimension"):
        dimension = Dimension(variant["dimension"])
        system = UnitSystem(variant["unit_system"]) if variant.get("unit_system") else None
        unit = units_service.resolve_unit(dimension, system)
        return MeasurementPreference(dimension=dimension, unit_system=system, unit=unit)

    food = food_definitions_service.get_by_id(global_food_definition_id)
    dimension = units_service.guess_dimension(food.preferred_unit) if food else Dimension.COUNT
    system: UnitSystem | None = None
    if dimension != Dimension.COUNT:
        household = households_service.get_household(household_id)
        system = household.preferred_unit_system if household else UnitSystem.CUSTOMARY
    return MeasurementPreference(
        dimension=dimension, unit_system=system, unit=units_service.resolve_unit(dimension, system)
    )


def _remember_measurement_choice(household_food_variant_id: UUID, preferred_unit: str) -> None:
    """Records the dimension/system implied by a just-created item's chosen
    unit onto its household_food_variant, so the next Add Item for this food
    in this household defaults to the same choice. Best-effort: an
    unrecognized unit guesses COUNT (see units.guess_dimension), which is
    harmless here since it just means the next add falls back to the usual
    default resolution instead of a remembered one.
    """
    dimension = units_service.guess_dimension(preferred_unit)
    system = units_service.guess_system(preferred_unit)
    client = get_service_client()
    client.table("household_food_variants").update(
        {"dimension": dimension.value, "unit_system": system.value if system else None}
    ).eq("id", str(household_food_variant_id)).execute()


def list_for_household(
    household_id: UUID,
    status: str | None = None,
    storage_location_id: UUID | None = None,
    household_food_variant_id: UUID | None = None,
) -> list[InventoryItem]:
    client = get_service_client()
    query = client.table(_TABLE).select(_ENRICHED_SELECT).eq("household_id", str(household_id))
    if status:
        query = query.eq("status", status)
    if storage_location_id:
        query = query.eq("storage_location_id", str(storage_location_id))
    if household_food_variant_id:
        query = query.eq("household_food_variant_id", str(household_food_variant_id))
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
        if "MEMBER_NOT_ALLOWED" in str(exc):
            raise MemberNotAllowedError from exc
        raise
    item = get_by_id(household_id, item_id)
    assert item is not None
    # Quantity hitting zero auto-transitions status to EMPTY (a DB trigger,
    # not this code) -- that's the item's story ending, so its final debt
    # gets computed and posted for real right here, once.
    if item.status != "ACTIVE":
        accounting_service.freeze_item_debt(item_id)
        item = get_by_id(household_id, item_id)
        assert item is not None
    return item


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
    # Discarding always leaves ACTIVE -- same "the item's story is over"
    # freeze point as consuming it to zero.
    accounting_service.freeze_item_debt(item_id)
    return get_by_id(household_id, item_id)  # type: ignore[return-value]


def update_item(
    household_id: UUID, item_id: UUID, body: UpdateInventoryItemRequest
) -> InventoryItem:
    """A genuine partial update (model_fields_set, not None-checks --
    expiry_date/best_by_date/name_override/storage_location_id are all
    legitimately clearable-or-settable). Dates, storage, nickname, and a
    same-dimension unit-system swap are always editable; cost,
    total_quantity, and allowed_member_ids are rejected once the item's
    debt has frozen (see correct_item instead).
    """
    current = get_by_id(household_id, item_id)
    if current is None:
        raise ItemNotFoundError

    fields = body.model_fields_set
    updates: dict = {}

    if "expiry_date" in fields:
        updates["expiry_date"] = body.expiry_date.isoformat() if body.expiry_date else None
    if "best_by_date" in fields:
        updates["best_by_date"] = body.best_by_date.isoformat() if body.best_by_date else None
    if "storage_location_id" in fields and body.storage_location_id is not None:
        updates["storage_location_id"] = str(body.storage_location_id)
    if "name_override" in fields:
        updates["name_override"] = body.name_override

    if "preferred_unit" in fields and body.preferred_unit is not None:
        new_unit = body.preferred_unit
        if units_service.guess_dimension(new_unit) != units_service.guess_dimension(
            current.preferred_unit
        ):
            raise UnitDimensionMismatchError
        converted_quantity = units_service.convert(
            current.quantity, current.preferred_unit, new_unit
        )
        converted_total = units_service.convert(
            current.total_quantity, current.preferred_unit, new_unit
        )
        if converted_quantity is None or converted_total is None:
            raise UnitDimensionMismatchError
        updates["preferred_unit"] = new_unit
        updates["quantity"] = str(converted_quantity)
        updates["total_quantity"] = str(converted_total)
        _remember_measurement_choice(current.household_food_variant_id, new_unit)

    frozen_gated_fields = {"cost", "total_quantity", "allowed_member_ids"}
    if frozen_gated_fields & fields and current.debt_frozen_at is not None:
        raise ItemFrozenError

    if "cost" in fields and body.cost is not None:
        updates["cost"] = str(body.cost)
    if "total_quantity" in fields and body.total_quantity is not None:
        # Applies the delta additively to both total_quantity and the
        # current remaining quantity -- "we actually had 10 the whole time"
        # should add to what's left, not overwrite it and silently erase
        # whatever's already been consumed.
        delta = body.total_quantity - current.total_quantity
        new_quantity = current.quantity + delta
        if new_quantity < 0:
            raise ValueError("That would take the remaining quantity below zero")
        updates["total_quantity"] = str(body.total_quantity)
        updates["quantity"] = str(new_quantity)

    client = get_service_client()
    if updates:
        client.table(_TABLE).update(updates).eq("household_id", str(household_id)).eq(
            "id", str(item_id)
        ).execute()

    if "allowed_member_ids" in fields and body.allowed_member_ids is not None:
        client.table("inventory_item_allowed_members").delete().eq(
            "inventory_item_id", str(item_id)
        ).execute()
        client.table("inventory_item_allowed_members").insert(
            [
                {"inventory_item_id": str(item_id), "member_id": str(member_id)}
                for member_id in body.allowed_member_ids
            ]
        ).execute()
        # split_member_count mirrors the roster size for non-PERSONAL items
        # -- it's what compute_item_shares' allotment sizing is ultimately
        # derived from at freeze time, so it needs to stay in sync while
        # the roster is still live-editable.
        if current.accounting_type != "PERSONAL":
            client.table(_TABLE).update(
                {"split_member_count": len(body.allowed_member_ids)}
            ).eq("id", str(item_id)).execute()

    return get_by_id(household_id, item_id)  # type: ignore[return-value]


def correct_item(
    household_id: UUID, member_id: UUID, item_id: UUID, body: CorrectInventoryItemRequest
) -> InventoryItem:
    """Only valid once an item's debt has already frozen -- update_item is
    what handles cost/quantity changes before that. Records a
    purchase_corrections row and, for a cost change on a non-PERSONAL item,
    posts a new ADJUSTMENT ledger entry per affected member for the delta
    (same split rule as everywhere else, applied to just the difference).
    A quantity-only correction touches inventory_items directly with no
    ledger impact, same additive-delta reasoning as update_item.
    """
    current = get_by_id(household_id, item_id)
    if current is None:
        raise ItemNotFoundError
    if current.debt_frozen_at is None:
        raise ItemNotFrozenError

    client = get_service_client()
    correction_row: dict = {
        "household_id": str(household_id),
        "inventory_item_id": str(item_id),
        "corrected_by_member_id": str(member_id),
        "note": body.note,
    }

    item_updates: dict = {}
    if body.new_cost is not None:
        correction_row["previous_cost"] = str(current.cost)
        correction_row["new_cost"] = str(body.new_cost)
        item_updates["cost"] = str(body.new_cost)
    if body.new_total_quantity is not None:
        delta = body.new_total_quantity - current.total_quantity
        new_quantity = current.quantity + delta
        if new_quantity < 0:
            raise ValueError("That would take the remaining quantity below zero")
        correction_row["previous_total_quantity"] = str(current.total_quantity)
        correction_row["new_total_quantity"] = str(body.new_total_quantity)
        item_updates["total_quantity"] = str(body.new_total_quantity)
        item_updates["quantity"] = str(new_quantity)

    client.table("purchase_corrections").insert(correction_row).execute()
    if item_updates:
        client.table(_TABLE).update(item_updates).eq("id", str(item_id)).execute()

    if body.new_cost is not None and current.accounting_type != "PERSONAL":
        delta_cost = body.new_cost - current.cost
        if delta_cost != 0:
            purchase_event = (
                client.table("purchase_events")
                .select("member_id")
                .eq("id", str(current.purchase_event_id))
                .single()
                .execute()
            )
            buyer_id = UUID(purchase_event.data["member_id"])
            allowed = (
                client.table("inventory_item_allowed_members")
                .select("member_id")
                .eq("inventory_item_id", str(item_id))
                .execute()
            )
            member_ids = [UUID(row["member_id"]) for row in allowed.data]
            consumption = (
                client.table("consumption_events")
                .select("member_id, quantity_used")
                .eq("inventory_item_id", str(item_id))
                .execute()
            )
            usage_by_member: dict[UUID, Decimal | None] = {}
            for row_ in consumption.data:
                consumer_id = UUID(row_["member_id"])
                used = Decimal(str(row_["quantity_used"]))
                usage_by_member[consumer_id] = (
                    usage_by_member.get(consumer_id) or Decimal(0)
                ) + used
            # The delta is split by the same rule as everything else,
            # applied to just the difference -- reusing the item's actual
            # recorded usage so a member who was over their allotment stays
            # the one whose share moves, instead of smearing the delta
            # equally across everyone regardless of who actually drove it.
            shares = accounting_service.compute_item_shares(
                total_quantity=current.total_quantity,
                total_cost=abs(delta_cost),
                member_ids=member_ids,
                buyer_id=buyer_id,
                usage_by_member=usage_by_member,
            )
            # Cost went up: each member now owes the buyer more. Cost went
            # down: the buyer now owes each member a refund -- same shares,
            # opposite direction.
            entries = [
                {
                    "household_id": str(household_id),
                    "creditor_member_id": str(buyer_id if delta_cost > 0 else member_id),
                    "debtor_member_id": str(member_id if delta_cost > 0 else buyer_id),
                    "amount": str(amount),
                    "reason": "ADJUSTMENT",
                }
                for member_id, amount in shares.items()
                if amount > 0
            ]
            if entries:
                client.table("ledger_entries").insert(entries).execute()

    return get_by_id(household_id, item_id)  # type: ignore[return-value]


def list_corrections(household_id: UUID, item_id: UUID) -> list[PurchaseCorrection]:
    client = get_service_client()
    result = (
        client.table("purchase_corrections")
        .select("*")
        .eq("household_id", str(household_id))
        .eq("inventory_item_id", str(item_id))
        .order("created_at", desc=True)
        .execute()
    )
    return [PurchaseCorrection(**row) for row in result.data]


def find_last_cost(
    household_id: UUID, global_food_definition_id: UUID, quantity: Decimal
) -> Decimal | None:
    """Cost of the most recent past purchase of this exact food + quantity in
    this household, if any -- powers the Add Item form's "same as last time"
    cost autofill. Two plain single-table lookups rather than one filtered
    join: PostgREST needs an explicit !inner hint to filter on an embedded
    table's column, which is easy to get subtly wrong; a household only has
    one variant per food definition anyway; both look up rows.
    """
    client = get_service_client()
    variant_result = (
        client.table("household_food_variants")
        .select("id")
        .eq("household_id", str(household_id))
        .eq("global_food_definition_id", str(global_food_definition_id))
        .maybe_single()
        .execute()
    )
    if not variant_result or not variant_result.data:
        return None

    item_result = (
        client.table(_TABLE)
        .select("cost")
        .eq("household_id", str(household_id))
        .eq("household_food_variant_id", variant_result.data["id"])
        .eq("total_quantity", str(quantity))
        .order("purchased_at", desc=True)
        .limit(1)
        .execute()
    )
    if not item_result.data:
        return None
    return Decimal(str(item_result.data[0]["cost"]))


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


def list_active_member_ids(household_id: UUID) -> set[UUID]:
    """Batch counterpart to allowed_member_ids_are_valid, for callers
    validating many items' allowed_member_ids in one pass (e.g. receipt
    finalize) without a query per item."""
    client = get_service_client()
    result = (
        client.table("members")
        .select("id")
        .eq("household_id", str(household_id))
        .eq("is_active", True)
        .execute()
    )
    return {UUID(row["id"]) for row in result.data}


def resolve_accounting_types(
    global_food_definition_ids: list[UUID],
) -> dict[UUID, AccountingType]:
    """Batch counterpart to _resolve_accounting_type's default lookup, for
    callers processing multiple items at once (e.g. receipt finalize)."""
    if not global_food_definition_ids:
        return {}
    client = get_service_client()
    result = (
        client.table("global_food_definitions")
        .select("id, accounting_type_default")
        .in_("id", [str(i) for i in set(global_food_definition_ids)])
        .execute()
    )
    return {UUID(row["id"]): AccountingType(row["accounting_type_default"]) for row in result.data}
