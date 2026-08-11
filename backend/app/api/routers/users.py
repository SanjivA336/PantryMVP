from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import get_current_user_id
from app.core.responses import Envelope, ok
from app.services import users as users_service

router = APIRouter(prefix="/users", tags=["users"])


@router.delete("/me", response_model=Envelope[None])
def delete_my_account(user_id: UUID = Depends(get_current_user_id)) -> Envelope[None]:
    try:
        users_service.delete_own_account(user_id)
    except users_service.OwnsHouseholdsError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "You own "
            + ", ".join(exc.household_names)
            + " — transfer ownership to another admin or delete the kitchen before "
            "deleting your account.",
        ) from exc
    except users_service.LastAdminError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "You're the last admin of "
            + ", ".join(exc.household_names)
            + " — promote another member before deleting your account.",
        ) from exc
    return ok(None)
