from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import require_household_admin, require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member, UpdateMemberRequest
from app.services import members as members_service

router = APIRouter(prefix="/households/{household_id}/members", tags=["members"])


def _ensure_not_last_admin(household_id: UUID, target: Member) -> None:
    if target.is_admin and members_service.count_active_admins(household_id) <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This is the last remaining admin — promote another member before removing them.",
        )


@router.get("", response_model=Envelope[list[Member]])
def list_members(
    household_id: UUID, _member: Member = Depends(require_household_membership)
) -> Envelope[list[Member]]:
    return ok(members_service.list_members(household_id))


@router.patch("/{member_id}", response_model=Envelope[Member])
def update_member(
    household_id: UUID,
    member_id: UUID,
    body: UpdateMemberRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[Member]:
    target = members_service.get_member_by_id(household_id, member_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")

    updates: dict = {}

    if body.nickname is not None:
        if not (caller.is_admin or caller.id == target.id):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Can only rename yourself unless you're an admin"
            )
        updates["nickname"] = body.nickname

    if body.is_admin is not None:
        if not caller.is_admin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
        if body.is_admin is False:
            _ensure_not_last_admin(household_id, target)
        updates["is_admin"] = body.is_admin

    if not updates:
        return ok(target)

    updated = members_service.update_member(household_id, member_id, updates)
    return ok(updated)


@router.post("/{member_id}/leave", response_model=Envelope[Member])
def leave_household(
    household_id: UUID,
    member_id: UUID,
    caller: Member = Depends(require_household_membership),
) -> Envelope[Member]:
    if caller.id != member_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Can only remove yourself via this endpoint")
    _ensure_not_last_admin(household_id, caller)
    updated = members_service.deactivate_member(household_id, member_id)
    return ok(updated)


@router.delete("/{member_id}", response_model=Envelope[Member])
def remove_member(
    household_id: UUID,
    member_id: UUID,
    _admin: Member = Depends(require_household_admin),
) -> Envelope[Member]:
    target = members_service.get_member_by_id(household_id, member_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Member not found")
    _ensure_not_last_admin(household_id, target)
    updated = members_service.deactivate_member(household_id, member_id)
    return ok(updated)
