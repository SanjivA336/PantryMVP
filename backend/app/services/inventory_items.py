from decimal import Decimal
from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.consumption import ConsumptionEvent, RecordConsumptionCorrectionRequest
from app.schemas.food_definition import AccountingType
from app.schemas.inventory_item import (
    CorrectInventoryItemRequest,
    CreateInventoryItemRequest,
    InventoryItem,
    PurchaseCorrection,
    RemovalReason,
    UpdateInventoryItemRequest,
)
from app.schemas.member import Member
from app.schemas.units import Dimension, MeasurementPreference, Unit, UnitSystem
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


class ConcurrentModificationError(Exception):
    """Raised by correct_item / correct_consumption when the item changed
    between the baseline read and the compare-and-swap claim -- another
    correction (or edit) landed first. The caller should re-read and retry."""

    pass


class ConsumptionEventNotFoundError(Exception):
    """The consumption event a correction targets doesn't exist, doesn't
    belong to this item, or isn't an original USAGE entry."""

    pass


def _flatten(row: dict) -> InventoryItem:
    variant = row.pop("household_food_variants", None) or {}
    storage = row.pop("storage_locations", None) or {}
    allowed = row.pop("inventory_item_allowed_members", None) or []
    global_definition = variant.get("global_food_definitions") or {}

    # quantity / total_quantity are persisted in the dimension's base unit
    # (migration 0028). The API still speaks the user's unit, so convert
    # back here -- this is the read boundary. `display_unit` (the column) is
    # surfaced under the schema's long-standing `preferred_unit` name.
    display_unit = Unit(row.pop("display_unit"))
    row["preferred_unit"] = display_unit
    row["quantity"] = units_service.display_quantity(Decimal(str(row["quantity"])), display_unit)
    row["total_quantity"] = units_service.display_quantity(
        Decimal(str(row["total_quantity"])), display_unit
    )

    # This item's own label wins over the food's name -- two jugs of the
    # same food definition can be told apart ("HEB milk" vs "Costco milk")
    # without needing separate variants or losing the shared running total.
    row["food_name"] = row.get("name_override") or global_definition.get("name") or "Unknown food"
    row["food_type_name"] = global_definition.get("name") or "Unknown food"
    row["category"] = global_definition.get("category")
    row["storage_location_name"] = storage.get("name") or "Unknown location"
    row["allowed_member_ids"] = [a["member_id"] for a in allowed]

    return InventoryItem(**row)


def _raw_base(household_id: UUID, item_id: UUID) -> tuple[Decimal, Decimal, Unit, str] | None:
    """(quantity, total_quantity, display_unit, updated_at) straight off the
    row, with the quantities in their stored base unit -- for the handful of
    writes (update_item / correct_item) that do additive quantity math and
    need an exact base value, not the rounded display value _flatten
    returns. updated_at is the raw string, used verbatim as correct_item's
    compare-and-swap token."""
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("quantity, total_quantity, display_unit, updated_at")
        .eq("household_id", str(household_id))
        .eq("id", str(item_id))
        .maybe_single()
        .execute()
    )
    if not result or not result.data:
        return None
    return (
        Decimal(str(result.data["quantity"])),
        Decimal(str(result.data["total_quantity"])),
        Unit(result.data["display_unit"]),
        result.data["updated_at"],
    )


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
            # Persisted in base units; the RPC writes what it's given. The
            # unit itself still rides along (as p_preferred_unit) and lands
            # in the display_unit column.
            "p_quantity": str(units_service.to_base(body.quantity, body.preferred_unit)),
            "p_preferred_unit": body.preferred_unit.value,
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


def _remember_measurement_choice(household_food_variant_id: UUID, preferred_unit: Unit) -> None:
    """Records the dimension/system implied by a just-created item's chosen
    unit onto its household_food_variant, so the next Add Item for this food
    in this household defaults to the same choice.
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
        # Just a display preference now -- the stored quantity is in base
        # units and doesn't move. This is what makes repeated metric<->
        # customary toggles a no-op instead of an error-accumulating
        # multiply/divide (see migration 0028).
        updates["display_unit"] = new_unit.value
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
        # whatever's already been consumed. All in base units: body's value
        # is in the item's display unit, everything stored is base.
        raw = _raw_base(household_id, item_id)
        assert raw is not None
        current_qty_base, current_total_base, display_unit, _ = raw
        new_total_base = units_service.to_base(body.total_quantity, display_unit)
        new_quantity_base = current_qty_base + (new_total_base - current_total_base)
        if new_quantity_base < 0:
            raise ValueError("That would take the remaining quantity below zero")
        updates["total_quantity"] = str(new_total_base)
        updates["quantity"] = str(new_quantity_base)

    client = get_service_client()
    if updates:
        client.table(_TABLE).update(updates).eq("household_id", str(household_id)).eq(
            "id", str(item_id)
        ).execute()

    if "allowed_member_ids" in fields and body.allowed_member_ids is not None:
        # One transaction, under a row lock on the item: the delete + insert
        # + split_member_count bump can't interleave with a concurrent
        # roster edit, and freeze_item_debt can't catch the roster
        # half-swapped. See migration 0030.
        client.rpc(
            "set_inventory_item_roster",
            {
                "p_household_id": str(household_id),
                "p_item_id": str(item_id),
                "p_member_ids": [str(m) for m in body.allowed_member_ids],
            },
        ).execute()

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
    raw = _raw_base(household_id, item_id)
    assert raw is not None
    current_qty_base, current_total_base, display_unit, baseline_updated_at = raw

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
        # body's value is in the item's display unit; everything stored
        # (here and on purchase_corrections) is base. list_corrections
        # converts these snapshots back for display.
        new_total_base = units_service.to_base(body.new_total_quantity, display_unit)
        new_quantity_base = current_qty_base + (new_total_base - current_total_base)
        if new_quantity_base < 0:
            raise ValueError("That would take the remaining quantity below zero")
        correction_row["previous_total_quantity"] = str(current_total_base)
        correction_row["new_total_quantity"] = str(new_total_base)
        item_updates["total_quantity"] = str(new_total_base)
        item_updates["quantity"] = str(new_quantity_base)

    # Claim the correction with a compare-and-swap on the item row before
    # writing anything -- two concurrent corrections that both read the same
    # baseline would otherwise each post their delta, adjusting the ledger
    # by the sum while the item moved once. Mirrors freeze_item_debt's CAS.
    # (item_updates is always non-empty: the request validator requires
    # new_cost or new_total_quantity.)
    claim = (
        client.table(_TABLE)
        .update(item_updates)
        .eq("household_id", str(household_id))
        .eq("id", str(item_id))
        .eq("updated_at", baseline_updated_at)
        .execute()
    )
    if not claim.data:
        raise ConcurrentModificationError

    client.table("purchase_corrections").insert(correction_row).execute()

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
                # Base units, to line up with the base consumption_events
                # quantities in usage_by_member above.
                total_quantity=current_total_base,
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
    item = (
        client.table(_TABLE).select("display_unit").eq("id", str(item_id)).maybe_single().execute()
    )
    display_unit = Unit(item.data["display_unit"]) if item and item.data else None

    result = (
        client.table("purchase_corrections")
        .select("*")
        .eq("household_id", str(household_id))
        .eq("inventory_item_id", str(item_id))
        .order("created_at", desc=True)
        .execute()
    )
    corrections: list[PurchaseCorrection] = []
    for row in result.data:
        # The quantity snapshots are stored in base units; render them in
        # the item's current display unit. Cost columns are dollars, left
        # alone.
        if display_unit is not None:
            for field in ("previous_total_quantity", "new_total_quantity"):
                if row.get(field) is not None:
                    row[field] = str(
                        units_service.display_quantity(Decimal(str(row[field])), display_unit)
                    )
        corrections.append(PurchaseCorrection(**row))
    return corrections


def list_consumption(household_id: UUID, item_id: UUID) -> list[ConsumptionEvent]:
    """Every usage + correction row for an item, oldest first -- powers the
    "Usage" list on the item detail page. quantity_used is converted from
    the stored base value into the item's display unit, same as everywhere
    else the API speaks quantities."""
    client = get_service_client()
    item = (
        client.table(_TABLE).select("display_unit").eq("id", str(item_id)).maybe_single().execute()
    )
    display_unit = Unit(item.data["display_unit"]) if item and item.data else Unit.COUNT

    rows = (
        client.table("consumption_events")
        .select("*")
        .eq("household_id", str(household_id))
        .eq("inventory_item_id", str(item_id))
        .order("consumed_at", desc=False)
        .execute()
    ).data
    events: list[ConsumptionEvent] = []
    for row in rows:
        events.append(
            ConsumptionEvent(
                id=row["id"],
                member_id=row["member_id"],
                inventory_item_id=row["inventory_item_id"],
                quantity_used=units_service.display_quantity(
                    Decimal(str(row["quantity_used"])), display_unit
                ),
                unit=display_unit,
                kind=row["kind"],
                corrects_event_id=row["corrects_event_id"],
                note=row["note"],
                consumed_at=row["consumed_at"],
            )
        )
    return events


def _post_usage_correction_adjustments(
    client,
    household_id: UUID,
    item: InventoryItem,
    total_base: Decimal,
    corrected_member_id: UUID,
    delta_base: Decimal,
) -> None:
    """A frozen item's PURCHASE ledger_entries were split against the usage
    on record at freeze time. A usage correction changes that split, so
    post the per-member difference as ADJUSTMENT entries -- exactly the
    shape correct_item uses for a cost change, except the driver here is
    the usage delta, not a cost delta. Assumes the CORRECTION event has
    already been written (so consumption_events reflects the new usage).
    """
    purchase_event = (
        client.table("purchase_events")
        .select("member_id")
        .eq("id", str(item.purchase_event_id))
        .single()
        .execute()
    )
    buyer_id = UUID(purchase_event.data["member_id"])
    allowed = (
        client.table("inventory_item_allowed_members")
        .select("member_id")
        .eq("inventory_item_id", str(item.id))
        .execute()
    )
    member_ids = [UUID(row["member_id"]) for row in allowed.data]

    consumption = (
        client.table("consumption_events")
        .select("member_id, quantity_used")
        .eq("inventory_item_id", str(item.id))
        .execute()
    )
    new_usage: dict[UUID, Decimal] = {}
    for row in consumption.data:
        member_id = UUID(row["member_id"])
        new_usage[member_id] = new_usage.get(member_id, Decimal(0)) + Decimal(
            str(row["quantity_used"])
        )
    old_usage = dict(new_usage)
    old_usage[corrected_member_id] = old_usage.get(corrected_member_id, Decimal(0)) - delta_base

    cost = Decimal(str(item.cost))
    old_shares = accounting_service.compute_item_shares(
        total_quantity=total_base,
        total_cost=cost,
        member_ids=member_ids,
        buyer_id=buyer_id,
        usage_by_member=dict(old_usage),
    )
    new_shares = accounting_service.compute_item_shares(
        total_quantity=total_base,
        total_cost=cost,
        member_ids=member_ids,
        buyer_id=buyer_id,
        usage_by_member=dict(new_usage),
    )

    entries = []
    for member_id in member_ids:
        if member_id == buyer_id:
            continue
        diff = new_shares.get(member_id, Decimal(0)) - old_shares.get(member_id, Decimal(0))
        if diff == 0:
            continue
        # diff > 0: this member's final share went up -> they owe the buyer
        # more. diff < 0: their share dropped -> the buyer owes them back.
        entries.append(
            {
                "household_id": str(household_id),
                "creditor_member_id": str(buyer_id if diff > 0 else member_id),
                "debtor_member_id": str(member_id if diff > 0 else buyer_id),
                "amount": str(abs(diff)),
                "reason": "ADJUSTMENT",
            }
        )
    if entries:
        client.table("ledger_entries").insert(entries).execute()


def correct_consumption(
    household_id: UUID,
    caller: Member,
    item_id: UUID,
    body: RecordConsumptionCorrectionRequest,
) -> InventoryItem:
    """Append a CORRECTION row that fixes a mis-logged usage entry.

    consumption_events stays immutable -- this writes a new signed-delta
    row, never edits the original. inventory_items.quantity is a
    maintained cache, so it's recomputed here (current - delta); the
    billing side is either live (nothing to do, _live_shares nets the
    delta on the next read) or already frozen (post ADJUSTMENT entries for
    the re-split). If the correction empties a still-live item, it freezes
    the same way consume() does.
    """
    current = get_by_id(household_id, item_id)
    if current is None:
        raise ItemNotFoundError
    raw = _raw_base(household_id, item_id)
    assert raw is not None
    current_qty_base, current_total_base, display_unit, baseline_updated_at = raw

    client = get_service_client()
    original = (
        client.table("consumption_events")
        .select("member_id, quantity_used, kind")
        .eq("id", str(body.corrects_event_id))
        .eq("household_id", str(household_id))
        .eq("inventory_item_id", str(item_id))
        .maybe_single()
        .execute()
    )
    if not original or not original.data or original.data["kind"] != "USAGE":
        raise ConsumptionEventNotFoundError
    corrected_member_id = UUID(original.data["member_id"])
    original_base = Decimal(str(original.data["quantity_used"]))

    # Net of any earlier corrections to this same entry, so a second
    # correction measures its delta from the current effective value, not
    # the untouched original.
    priors = (
        client.table("consumption_events")
        .select("quantity_used")
        .eq("corrects_event_id", str(body.corrects_event_id))
        .execute()
    )
    effective_base = original_base + sum(
        (Decimal(str(r["quantity_used"])) for r in priors.data), Decimal(0)
    )

    unit = body.unit or display_unit
    if units_service.guess_dimension(unit) != units_service.guess_dimension(display_unit):
        raise ValueError("That unit isn't compatible with how this item is measured")
    actual_base = units_service.to_base(body.actual_quantity, unit)
    delta_base = actual_base - effective_base
    if delta_base == 0:
        raise ValueError("The corrected amount matches what's already recorded")

    # Σ usage moves by delta, so remaining moves by -delta.
    new_quantity_base = current_qty_base - delta_base
    if new_quantity_base < 0:
        raise ValueError("That would put more total usage on the item than it ever held")
    if new_quantity_base > current_total_base:
        raise ValueError("That correction implies negative total usage")

    # Compare-and-swap on the item row before writing anything -- two
    # concurrent corrections would otherwise both recompute quantity and
    # (for a frozen item) both post adjustments. Mirrors correct_item.
    claim = (
        client.table(_TABLE)
        .update({"quantity": str(new_quantity_base)})
        .eq("household_id", str(household_id))
        .eq("id", str(item_id))
        .eq("updated_at", baseline_updated_at)
        .execute()
    )
    if not claim.data:
        raise ConcurrentModificationError

    client.table("consumption_events").insert(
        {
            "household_id": str(household_id),
            "member_id": str(corrected_member_id),
            "inventory_item_id": str(item_id),
            "quantity_used": str(delta_base),
            "kind": "CORRECTION",
            "corrects_event_id": str(body.corrects_event_id),
            "note": body.note,
        }
    ).execute()

    if current.debt_frozen_at is not None and current.accounting_type != "PERSONAL":
        _post_usage_correction_adjustments(
            client, household_id, current, current_total_base, corrected_member_id, delta_base
        )
    else:
        # A correction that pushes usage to the item's limit takes quantity
        # to 0, and the inventory_items quantity=0 trigger has already
        # flipped a still-ACTIVE item to EMPTY on the claim above. Freeze
        # it, the same way consume() does. freeze_item_debt no-ops for
        # PERSONAL and for anything already frozen.
        refreshed = get_by_id(household_id, item_id)
        if (
            refreshed is not None
            and refreshed.status != "ACTIVE"
            and refreshed.debt_frozen_at is None
        ):
            accounting_service.freeze_item_debt(item_id)

    return get_by_id(household_id, item_id)  # type: ignore[return-value]


def find_last_cost(
    household_id: UUID,
    global_food_definition_id: UUID,
    quantity: Decimal,
    unit: Unit,
) -> Decimal | None:
    """Cost of the most recent past purchase of this food at this same
    quantity in this household -- powers the Add Item form's "same as last
    time" cost autofill. `quantity`/`unit` are what the form currently
    shows; stored total_quantity is in base units, so compare on the
    display value rounded the same way the API rounds it.
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
        .select("cost, total_quantity")
        .eq("household_id", str(household_id))
        .eq("household_food_variant_id", variant_result.data["id"])
        .order("purchased_at", desc=True)
        .limit(20)
        .execute()
    )
    target = units_service.display_quantity(units_service.to_base(quantity, unit), unit)
    for row in item_result.data:
        stored = units_service.display_quantity(Decimal(str(row["total_quantity"])), unit)
        if stored == target:
            return Decimal(str(row["cost"]))
    return None


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
