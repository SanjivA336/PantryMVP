from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.household import Household

_TABLE = "households"


class InvalidJoinCodeError(Exception):
    pass


def _coerce_household(data: dict | list) -> Household:
    # RPCs returning a single composite row can come back as either a bare
    # dict or a one-element list depending on client/postgrest version.
    row = data[0] if isinstance(data, list) else data
    return Household(**row)


def list_households_for_user(user_id: UUID) -> list[Household]:
    client = get_service_client()
    result = (
        client.table("members")
        .select("households(*)")
        .eq("user_id", str(user_id))
        .eq("is_active", True)
        .execute()
    )
    return [Household(**row["households"]) for row in result.data if row.get("households")]


def get_household(household_id: UUID) -> Household | None:
    client = get_service_client()
    result = client.table(_TABLE).select("*").eq("id", str(household_id)).maybe_single().execute()
    return Household(**result.data) if result and result.data else None


def create_household_and_join(
    user_id: UUID, name: str, address: str | None, nickname: str
) -> Household:
    client = get_service_client()
    result = client.rpc(
        "create_household_and_join",
        {
            "p_user_id": str(user_id),
            "p_name": name,
            "p_address": address,
            "p_nickname": nickname,
        },
    ).execute()
    return _coerce_household(result.data)


def join_household_by_code(user_id: UUID, join_code: str, nickname: str) -> Household:
    client = get_service_client()
    try:
        result = client.rpc(
            "join_household_by_code",
            {
                "p_user_id": str(user_id),
                "p_join_code": join_code,
                "p_nickname": nickname,
            },
        ).execute()
    except APIError as exc:
        if "INVALID_JOIN_CODE" in str(exc):
            raise InvalidJoinCodeError from exc
        raise
    return _coerce_household(result.data)


def delete_household(household_id: UUID) -> None:
    client = get_service_client()
    client.table(_TABLE).delete().eq("id", str(household_id)).execute()
