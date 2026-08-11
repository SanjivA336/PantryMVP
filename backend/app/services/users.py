from uuid import UUID

import httpx

from app.core.config import get_settings
from app.core.supabase import get_service_client
from app.services import members as members_service


class OwnsHouseholdsError(Exception):
    """Raised when the account being deleted still owns one or more
    households -- ownership must be transferred or the household deleted
    first (see households.py's transfer_ownership / delete_household),
    never silently dropped as a side effect of account deletion."""

    def __init__(self, household_names: list[str]) -> None:
        self.household_names = household_names


class LastAdminError(Exception):
    """Raised when deleting this account would leave a household with zero
    active admins -- same safety net members.py's leave endpoint already
    enforces via _ensure_not_last_admin, applied across every membership at
    once so deletion stays all-or-nothing."""

    def __init__(self, household_names: list[str]) -> None:
        self.household_names = household_names


def _active_memberships(user_id: UUID) -> list[dict]:
    client = get_service_client()
    result = (
        client.table("members")
        .select("id, household_id, is_admin, households(name, owner_id)")
        .eq("user_id", str(user_id))
        .eq("is_active", True)
        .execute()
    )
    return result.data


def delete_own_account(user_id: UUID) -> None:
    memberships = _active_memberships(user_id)

    owned = [
        m["households"]["name"]
        for m in memberships
        if m.get("households") and m["households"]["owner_id"] == str(user_id)
    ]
    if owned:
        raise OwnsHouseholdsError(owned)

    last_admin = [
        m["households"]["name"]
        for m in memberships
        if m["is_admin"] and members_service.count_active_admins(UUID(m["household_id"])) <= 1
    ]
    if last_admin:
        raise LastAdminError(last_admin)

    for m in memberships:
        members_service.deactivate_member(UUID(m["household_id"]), UUID(m["id"]))

    _delete_auth_user(user_id)


def _delete_auth_user(user_id: UUID) -> None:
    settings = get_settings()
    with httpx.Client(base_url=settings.supabase_url) as client:
        response = client.delete(
            f"/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
        )
        response.raise_for_status()
