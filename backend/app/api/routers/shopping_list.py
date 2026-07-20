from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.shopping_list import (
    CreateShoppingListItemRequest,
    CreateShoppingListSectionRequest,
    ShoppingListItem,
    ShoppingListSection,
)
from app.services import shopping_list as shopping_list_service

router = APIRouter(prefix="/households/{household_id}/shopping-list", tags=["shopping-list"])


@router.get("/sections", response_model=Envelope[list[ShoppingListSection]])
def list_sections(
    household_id: UUID, _member: Member = Depends(require_household_membership)
) -> Envelope[list[ShoppingListSection]]:
    return ok(shopping_list_service.list_sections(household_id))


@router.post(
    "/sections", response_model=Envelope[ShoppingListSection], status_code=status.HTTP_201_CREATED
)
def create_section(
    household_id: UUID,
    body: CreateShoppingListSectionRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[ShoppingListSection]:
    return ok(shopping_list_service.create_section(household_id, body.name))


@router.delete("/sections/{section_id}", response_model=Envelope[None])
def delete_section(
    household_id: UUID,
    section_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    shopping_list_service.delete_section(household_id, section_id)
    return ok(None)


@router.get("/items", response_model=Envelope[list[ShoppingListItem]])
def list_items(
    household_id: UUID,
    status_filter: str | None = Query(default="ACTIVE", alias="status"),
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[ShoppingListItem]]:
    return ok(shopping_list_service.list_items(household_id, status_filter))


@router.post(
    "/items", response_model=Envelope[ShoppingListItem], status_code=status.HTTP_201_CREATED
)
def create_item(
    household_id: UUID,
    body: CreateShoppingListItemRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[ShoppingListItem]:
    return ok(shopping_list_service.create_manual_item(household_id, caller.id, body))


@router.delete("/items/{item_id}", response_model=Envelope[ShoppingListItem])
def remove_item(
    household_id: UUID,
    item_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[ShoppingListItem]:
    try:
        item = shopping_list_service.remove_item(household_id, item_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    return ok(item)


@router.post("/suggest", response_model=Envelope[list[ShoppingListItem]])
def suggest_items(
    household_id: UUID,
    caller: Member = Depends(require_household_membership),
) -> Envelope[list[ShoppingListItem]]:
    return ok(shopping_list_service.suggest_items(household_id, caller.id))
