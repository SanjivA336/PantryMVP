from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.warning import HouseholdWarnings
from app.services import warnings as warnings_service

router = APIRouter(prefix="/households/{household_id}/warnings", tags=["warnings"])


@router.get("", response_model=Envelope[HouseholdWarnings])
def get_household_warnings(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[HouseholdWarnings]:
    return ok(warnings_service.compute_warnings(household_id))


@router.post("/stock/{household_food_variant_id}/ignore", response_model=Envelope[None])
def ignore_stock_warning(
    household_id: UUID,
    household_food_variant_id: UUID,
    reference_unit: str = Query(),
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    warnings_service.ignore_stock_warning(household_id, household_food_variant_id, reference_unit)
    return ok(None)


@router.post("/expiry/{inventory_item_id}/ignore", response_model=Envelope[None])
def ignore_expiry_warning(
    household_id: UUID,
    inventory_item_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    warnings_service.ignore_expiry_warning(household_id, inventory_item_id)
    return ok(None)
