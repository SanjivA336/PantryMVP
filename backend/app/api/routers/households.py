from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_current_user_id, require_household_admin, require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.household import (
    CreateHouseholdRequest,
    Household,
    JoinHouseholdRequest,
    TransferOwnershipRequest,
    UpdateHouseholdRequest,
)
from app.schemas.member import Member
from app.services import households as households_service
from app.services import members as members_service

router = APIRouter(prefix="/households", tags=["households"])


@router.get("", response_model=Envelope[list[Household]])
def list_my_households(user_id: UUID = Depends(get_current_user_id)) -> Envelope[list[Household]]:
    return ok(households_service.list_households_for_user(user_id))


@router.post("", response_model=Envelope[Household], status_code=status.HTTP_201_CREATED)
def create_household(
    body: CreateHouseholdRequest, user_id: UUID = Depends(get_current_user_id)
) -> Envelope[Household]:
    household = households_service.create_household_and_join(
        user_id=user_id, name=body.name, address=body.address, nickname=body.nickname
    )
    return ok(household)


@router.post("/join", response_model=Envelope[Household])
def join_household(
    body: JoinHouseholdRequest, user_id: UUID = Depends(get_current_user_id)
) -> Envelope[Household]:
    try:
        household = households_service.join_household_by_code(
            user_id=user_id, join_code=body.join_code.upper(), nickname=body.nickname
        )
    except households_service.InvalidJoinCodeError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invalid join code") from exc
    return ok(household)


@router.get("/{household_id}", response_model=Envelope[Household])
def get_household(
    household_id: UUID, _member: Member = Depends(require_household_membership)
) -> Envelope[Household]:
    household = households_service.get_household(household_id)
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Household not found")
    return ok(household)


@router.patch("/{household_id}", response_model=Envelope[Household])
def update_household(
    household_id: UUID,
    body: UpdateHouseholdRequest,
    _member: Member = Depends(require_household_admin),
) -> Envelope[Household]:
    updates = body.model_dump(exclude_none=True)
    household = households_service.update_household(household_id, updates)
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Household not found")
    return ok(household)


@router.delete("/{household_id}", response_model=Envelope[None])
def delete_household(
    household_id: UUID, _member: Member = Depends(require_household_admin)
) -> Envelope[None]:
    households_service.delete_household(household_id)
    return ok(None)


@router.post("/{household_id}/transfer-ownership", response_model=Envelope[Household])
def transfer_ownership(
    household_id: UUID,
    body: TransferOwnershipRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[Household]:
    household = households_service.get_household(household_id)
    if household is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Household not found")
    if caller.user_id != household.owner_id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the current owner can transfer ownership"
        )

    target = members_service.get_member_by_id(household_id, body.new_owner_member_id)
    if target is None or not target.is_active or target.user_id is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    if not target.is_admin:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Promote this member to admin first -- ownership can only transfer to an "
            "existing admin, one rung at a time.",
        )

    updated = households_service.transfer_ownership(household_id, target.user_id)
    return ok(updated)
