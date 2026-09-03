from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.activity import ActivityEvent, ActivityType
from app.schemas.member import Member
from app.services import activity as activity_service

router = APIRouter(prefix="/households/{household_id}/activity", tags=["activity"])


@router.get("", response_model=Envelope[list[ActivityEvent]])
def list_activity(
    household_id: UUID,
    type: list[ActivityType] | None = Query(default=None),
    before: datetime | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[ActivityEvent]]:
    return ok(activity_service.list_feed(household_id, types=type, limit=limit, before=before))
