from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.inventory_item import (
    ConsumeInventoryItemRequest,
    CreateInventoryItemRequest,
    InventoryItem,
    RemovalReason,
)
from app.schemas.member import Member
from app.services import inventory_items as inventory_service

router = APIRouter(prefix="/households/{household_id}/inventory-items", tags=["inventory"])


@router.get("", response_model=Envelope[list[InventoryItem]])
def list_inventory_items(
    household_id: UUID,
    status_filter: str | None = Query(default=None, alias="status"),
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[InventoryItem]]:
    return ok(inventory_service.list_for_household(household_id, status_filter))


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
    item = inventory_service.create_manual(household_id, caller.id, body)
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


@router.post("/{item_id}/consume", response_model=Envelope[InventoryItem])
def consume_inventory_item(
    household_id: UUID,
    item_id: UUID,
    body: ConsumeInventoryItemRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    try:
        item = inventory_service.consume(household_id, caller.id, item_id, body.quantity_used)
    except inventory_service.InsufficientQuantityError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot use more than the item's remaining quantity",
        ) from exc
    return ok(item)


@router.delete("/{item_id}", response_model=Envelope[InventoryItem])
def discard_inventory_item(
    household_id: UUID,
    item_id: UUID,
    reason: RemovalReason = Query(default=RemovalReason.DISCARDED),
    _member: Member = Depends(require_household_membership),
) -> Envelope[InventoryItem]:
    # A query param, not a request body — DELETE-with-a-body is against HTTP
    # convention (some proxies/CDNs silently strip it), and httpx's own test
    # client doesn't support it on .delete() either.
    try:
        item = inventory_service.discard(household_id, item_id, reason)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return ok(item)
