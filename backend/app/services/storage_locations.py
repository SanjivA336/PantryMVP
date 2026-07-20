from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.storage_location import StorageLocation

_TABLE = "storage_locations"


def list_storage_locations(household_id: UUID) -> list[StorageLocation]:
    client = get_service_client()
    result = client.table(_TABLE).select("*").eq("household_id", str(household_id)).execute()
    return [StorageLocation(**row) for row in result.data]


def get_storage_location(household_id: UUID, location_id: UUID) -> StorageLocation | None:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .eq("id", str(location_id))
        .maybe_single()
        .execute()
    )
    return StorageLocation(**result.data) if result and result.data else None


def create_storage_location(household_id: UUID, data: dict) -> StorageLocation:
    client = get_service_client()
    result = client.table(_TABLE).insert({**data, "household_id": str(household_id)}).execute()
    return StorageLocation(**result.data[0])


def update_storage_location(household_id: UUID, location_id: UUID, data: dict) -> StorageLocation:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .update(data)
        .eq("household_id", str(household_id))
        .eq("id", str(location_id))
        .execute()
    )
    return StorageLocation(**result.data[0])


def delete_storage_location(household_id: UUID, location_id: UUID) -> None:
    client = get_service_client()
    client.table(_TABLE).delete().eq("household_id", str(household_id)).eq(
        "id", str(location_id)
    ).execute()
