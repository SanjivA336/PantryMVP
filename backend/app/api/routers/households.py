from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_current_user_id, require_household_admin, require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.household import CreateHouseholdRequest, Household, JoinHouseholdRequest
from app.schemas.member import Member
from app.services import households as households_service

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


@router.delete("/{household_id}", response_model=Envelope[None])
def delete_household(
    household_id: UUID, _member: Member = Depends(require_household_admin)
) -> Envelope[None]:
    households_service.delete_household(household_id)
    return ok(None)
