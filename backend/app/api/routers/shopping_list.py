from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.shopping_list import (
    CreateShoppingListItemRequest,
    CreateShoppingListSectionRequest,
    IgnoreShoppingListVariantRequest,
    ShoppingListItem,
    ShoppingListSection,
    UpdateShoppingListItemRequest,
    UpdateShoppingListSectionRequest,
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


@router.patch("/sections/{section_id}", response_model=Envelope[ShoppingListSection])
def update_section(
    household_id: UUID,
    section_id: UUID,
    body: UpdateShoppingListSectionRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[ShoppingListSection]:
    updates = body.model_dump(exclude_none=True)
    section = shopping_list_service.update_section(household_id, section_id, updates)
    if section is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found")
    return ok(section)


@router.delete("/sections/{section_id}", response_model=Envelope[None])
def delete_section(
    household_id: UUID,
    section_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    deleted = shopping_list_service.delete_section(household_id, section_id)
    if not deleted:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Section not found")
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
    try:
        item = shopping_list_service.create_manual_item(household_id, caller.id, body)
    except shopping_list_service.FoodDefinitionNotFoundError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Food definition not found") from exc
    return ok(item)


@router.patch("/items/{item_id}", response_model=Envelope[ShoppingListItem])
def update_item(
    household_id: UUID,
    item_id: UUID,
    body: UpdateShoppingListItemRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[ShoppingListItem]:
    # exclude_unset, not exclude_none: moving an item to "no section" sends
    # section_id: null on purpose, and exclude_none can't tell that apart
    # from the field never having been sent at all -- it would silently
    # drop the null and leave the item in its old section.
    updates = body.model_dump(exclude_unset=True)
    item = shopping_list_service.update_item(household_id, item_id, updates)
    if item is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Item not found")
    return ok(item)


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


@router.post("/clear", response_model=Envelope[None])
def clear_items(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    shopping_list_service.clear_items(household_id)
    return ok(None)


@router.post("/ignored-variants", response_model=Envelope[None])
def ignore_variant(
    household_id: UUID,
    body: IgnoreShoppingListVariantRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    shopping_list_service.ignore_variant_permanently(household_id, body.household_food_variant_id)
    return ok(None)


@router.post("/suggest", response_model=Envelope[list[ShoppingListItem]])
def suggest_items(
    household_id: UUID,
    caller: Member = Depends(require_household_membership),
) -> Envelope[list[ShoppingListItem]]:
    return ok(shopping_list_service.suggest_items(household_id, caller.id))
