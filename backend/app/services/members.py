from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.member import Member

_TABLE = "members"


def get_active_member(household_id: UUID, user_id: UUID) -> Member | None:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .eq("user_id", str(user_id))
        .eq("is_active", True)
        .maybe_single()
        .execute()
    )
    return Member(**result.data) if result and result.data else None


def get_member_by_id(household_id: UUID, member_id: UUID) -> Member | None:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .eq("id", str(member_id))
        .maybe_single()
        .execute()
    )
    return Member(**result.data) if result and result.data else None


def list_members(household_id: UUID) -> list[Member]:
    client = get_service_client()
    result = client.table(_TABLE).select("*").eq("household_id", str(household_id)).execute()
    return [Member(**row) for row in result.data]


def count_active_admins(household_id: UUID) -> int:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("id", count="exact")
        .eq("household_id", str(household_id))
        .eq("is_admin", True)
        .eq("is_active", True)
        .execute()
    )
    return result.count or 0


def update_member(household_id: UUID, member_id: UUID, updates: dict) -> Member:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .update(updates)
        .eq("household_id", str(household_id))
        .eq("id", str(member_id))
        .execute()
    )
    return Member(**result.data[0])


def deactivate_member(household_id: UUID, member_id: UUID) -> Member:
    return update_member(household_id, member_id, {"is_active": False})
