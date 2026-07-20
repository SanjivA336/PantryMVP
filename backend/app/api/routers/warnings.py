from uuid import UUID

from fastapi import APIRouter, Depends

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
