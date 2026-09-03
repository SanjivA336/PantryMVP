from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.activity import ActivityType
from app.schemas.consumption import ConsumptionEvent, RecordConsumptionCorrectionRequest
from app.schemas.inventory_item import (
    ConsumeInventoryItemRequest,
    CorrectInventoryItemRequest,
    CreateInventoryItemRequest,
    InventoryItem,
    PurchaseCorrection,
    RemovalReason,
    UpdateInventoryItemRequest,
)
from app.schemas.member import Member
from app.schemas.units import MeasurementPreference, Unit
from app.services import activity as activity_service
from app.services import inventory_items as inventory_service
from app.services import units as units_service

router = APIRouter(prefix="/households/{household_id}/inventory-items", tags=["inventory"])


@router.get("", response_model=Envelope[list[InventoryItem]])
def list_inventory_items(
    household_id: UUID,
    status_filter: str | None = Query(default=None, alias="status"),
    storage_location_id: UUID | None = Query(default=None),
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[InventoryItem]]:
    return ok(
        inventory_service.list_for_household(household_id, status_filter, storage_location_id)
    )


@router.get("/last-cost", response_model=Envelope[Decimal | None])
def get_last_cost(
    household_id: UUID,
    global_food_definition_id: UUID,
    quantity: Decimal,
    unit: Unit,
    _member: Member = Depends(require_household_membership),
) -> Envelope[Decimal | None]:
    return ok(
        inventory_service.find_last_cost(household_id, global_food_definition_id, quantity, unit)
    )


@router.get("/measurement-preference", response_model=Envelope[MeasurementPreference])
def get_measurement_preference(
    household_id: UUID,
    global_food_definition_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[MeasurementPreference]:
    return ok(
        inventory_service.resolve_measurement_preference(household_id, global_food_definition_id)
    )


@router.post("", response_model=Envelope[InventoryItem], status_code=status.HTTP_201_CREATED)
def create_inventory_item(
    household_id: UUID,
    body: CreateInventoryItemRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    if not inventory_service.allowed_member_ids_are_valid(household_id, body.allowed_member_ids):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "allowed_member_ids must all be active members of this household",
        )
    buyer_id = body.buyer_member_id or caller.id
    if body.buyer_member_id and not inventory_service.allowed_member_ids_are_valid(
        household_id, [body.buyer_member_id]
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "buyer_member_id must be an active member of this household",
        )
    try:
        item = inventory_service.create_manual(household_id, buyer_id, body)
    except inventory_service.FoodDefinitionNotFoundError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Food definition not found") from exc

    activity_service.record(
        household_id,
        ActivityType.ITEM_ADDED,
        actor=caller,
        subject_name=item.food_name,
        detail={
            "item_id": str(item.id),
            "quantity": str(item.total_quantity),
            "unit": item.preferred_unit.value,
            "storage_location": item.storage_location_name,
            "bought_by": None if buyer_id == caller.id else str(buyer_id),
        },
    )
    return ok(item)


@router.get("/{item_id}", response_model=Envelope[InventoryItem])
def get_inventory_item(
    household_id: UUID,
    item_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    item = inventory_service.get_by_id(household_id, item_id)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return ok(item)


@router.patch("/{item_id}", response_model=Envelope[InventoryItem])
def update_inventory_item(
    household_id: UUID,
    item_id: UUID,
    body: UpdateInventoryItemRequest,
    member: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    if body.allowed_member_ids is not None and not inventory_service.allowed_member_ids_are_valid(
        household_id, body.allowed_member_ids
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "allowed_member_ids must all be active members of this household",
        )
    # Only fetched when a storage move is actually in the payload -- needed
    # for the "from" side of the ITEM_MOVED event, which the post-update
    # item can't supply on its own.
    before = (
        inventory_service.get_by_id(household_id, item_id)
        if "storage_location_id" in body.model_fields_set and body.storage_location_id is not None
        else None
    )
    try:
        item = inventory_service.update_item(household_id, item_id, body)
    except inventory_service.ItemNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found") from exc
    except inventory_service.ItemFrozenError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "cost, total_quantity, and allowed_member_ids can no longer be edited directly "
            "once this item's debt has been finalized -- use the correction endpoint instead",
        ) from exc
    except inventory_service.UnitDimensionMismatchError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "preferred_unit can only switch between metric and customary within the same "
            "kind of measurement, not change what kind of measurement this food uses",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    if before is not None and before.storage_location_id != item.storage_location_id:
        activity_service.record(
            household_id,
            ActivityType.ITEM_MOVED,
            actor=member,
            subject_name=item.food_name,
            detail={
                "item_id": str(item.id),
                "from_location": before.storage_location_name,
                "to_location": item.storage_location_name,
            },
        )
    return ok(item)


@router.get("/{item_id}/corrections", response_model=Envelope[list[PurchaseCorrection]])
def list_item_corrections(
    household_id: UUID,
    item_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[PurchaseCorrection]]:
    return ok(inventory_service.list_corrections(household_id, item_id))


@router.post("/{item_id}/corrections", response_model=Envelope[InventoryItem])
def correct_inventory_item(
    household_id: UUID,
    item_id: UUID,
    body: CorrectInventoryItemRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    before = inventory_service.get_by_id(household_id, item_id)
    try:
        item = inventory_service.correct_item(household_id, caller.id, item_id, body)
    except inventory_service.ItemNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found") from exc
    except inventory_service.ItemNotFrozenError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This item's debt hasn't been finalized yet -- edit it directly instead",
        ) from exc
    except inventory_service.ConcurrentModificationError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This item was changed while you were correcting it -- reopen it and try again",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    if before is not None and body.new_cost is not None and body.new_cost != before.cost:
        activity_service.record(
            household_id,
            ActivityType.COST_CORRECTED,
            actor=caller,
            subject_name=before.food_name,
            detail={
                "item_id": str(item_id),
                "previous_cost": str(before.cost),
                "new_cost": str(body.new_cost),
                "note": body.note,
            },
        )
    return ok(item)


@router.get("/{item_id}/consumption", response_model=Envelope[list[ConsumptionEvent]])
def list_item_consumption(
    household_id: UUID,
    item_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[ConsumptionEvent]]:
    return ok(inventory_service.list_consumption(household_id, item_id))


@router.post("/{item_id}/consumption-corrections", response_model=Envelope[InventoryItem])
def correct_item_consumption(
    household_id: UUID,
    item_id: UUID,
    body: RecordConsumptionCorrectionRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    before = inventory_service.get_by_id(household_id, item_id)
    try:
        item = inventory_service.correct_consumption(household_id, caller, item_id, body)
    except inventory_service.ItemNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found") from exc
    except inventory_service.ConsumptionEventNotFoundError as exc:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "That usage entry doesn't exist on this item",
        ) from exc
    except inventory_service.ConcurrentModificationError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This item was changed while you were correcting it -- reopen it and try again",
        ) from exc
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc

    activity_service.record(
        household_id,
        ActivityType.USAGE_CORRECTED,
        actor=caller,
        subject_name=before.food_name if before is not None else None,
        detail={"item_id": str(item_id), "note": body.note},
    )
    return ok(item)


@router.post("/{item_id}/consume", response_model=Envelope[InventoryItem])
def consume_inventory_item(
    household_id: UUID,
    item_id: UUID,
    body: ConsumeInventoryItemRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    item_before = inventory_service.get_by_id(household_id, item_id)
    if item_before is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")

    # Stored quantities are in base units, so the decrement has to be too.
    used_unit = body.unit or item_before.preferred_unit
    if units_service.guess_dimension(used_unit) != units_service.guess_dimension(
        item_before.preferred_unit
    ):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "That unit can't be converted to how this item is measured",
        )
    used_base = units_service.to_base(body.quantity_used, used_unit)

    try:
        item = inventory_service.consume(household_id, caller.id, item_id, used_base)
    except inventory_service.InsufficientQuantityError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot use more than the item's remaining quantity",
        ) from exc
    except inventory_service.MemberNotAllowedError as exc:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You are not on this item's allowed-members list",
        ) from exc

    # Record what the human actually entered, not the converted-to-item-unit
    # value -- "used 1 cup" reads better than "used 236.588 ml".
    activity_service.record(
        household_id,
        ActivityType.ITEM_CONSUMED,
        actor=caller,
        subject_name=item.food_name,
        detail={
            "item_id": str(item.id),
            "amount": str(body.quantity_used),
            "unit": (body.unit or item_before.preferred_unit).value,
        },
    )
    # Consuming the last of something ends its story (the DB trigger flips
    # status to EMPTY). Reported without an actor, per the feed's design --
    # "the milk is used up", not "Sam used up the milk".
    if item.status != "ACTIVE":
        activity_service.record(
            household_id,
            ActivityType.ITEM_REMOVED,
            actor=None,
            subject_name=item.food_name,
            detail={"item_id": str(item.id), "reason": "USED_UP"},
        )
    return ok(item)


@router.delete("/{item_id}", response_model=Envelope[InventoryItem])
def discard_inventory_item(
    household_id: UUID,
    item_id: UUID,
    reason: RemovalReason = Query(default=RemovalReason.DISCARDED),
    member: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    # A query param, not a request body — DELETE-with-a-body is against HTTP
    # convention (some proxies/CDNs silently strip it), and httpx's own test
    # client doesn't support it on .delete() either.
    try:
        item = inventory_service.discard(household_id, item_id, reason)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc

    activity_service.record(
        household_id,
        ActivityType.ITEM_REMOVED,
        actor=member,
        subject_name=item.food_name,
        detail={"item_id": str(item.id), "reason": reason.value},
    )
    return ok(item)
