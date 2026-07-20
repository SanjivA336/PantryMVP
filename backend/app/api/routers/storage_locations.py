from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.member import Member
from app.schemas.storage_location import (
    CreateStorageLocationRequest,
    StorageLocation,
    UpdateStorageLocationRequest,
)
from app.services import storage_locations as storage_service

router = APIRouter(
    prefix="/households/{household_id}/storage-locations", tags=["storage-locations"]
)


@router.get("", response_model=Envelope[list[StorageLocation]])
def list_storage_locations(
    household_id: UUID, _member: Member = Depends(require_household_membership)
) -> Envelope[list[StorageLocation]]:
    return ok(storage_service.list_storage_locations(household_id))


@router.post("", response_model=Envelope[StorageLocation], status_code=status.HTTP_201_CREATED)
def create_storage_location(
    household_id: UUID,
    body: CreateStorageLocationRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[StorageLocation]:
    created = storage_service.create_storage_location(
        household_id, body.model_dump(exclude_none=True)
    )
    return ok(created)


@router.get("/{location_id}", response_model=Envelope[StorageLocation])
def get_storage_location(
    household_id: UUID,
    location_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[StorageLocation]:
    location = storage_service.get_storage_location(household_id, location_id)
    if location is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Storage location not found")
    return ok(location)


@router.patch("/{location_id}", response_model=Envelope[StorageLocation])
def update_storage_location(
    household_id: UUID,
    location_id: UUID,
    body: UpdateStorageLocationRequest,
    _member: Member = Depends(require_household_membership),
) -> Envelope[StorageLocation]:
    existing = storage_service.get_storage_location(household_id, location_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Storage location not found")
    updates = body.model_dump(exclude_none=True)
    if not updates:
        return ok(existing)
    updated = storage_service.update_storage_location(household_id, location_id, updates)
    return ok(updated)


@router.delete("/{location_id}", response_model=Envelope[None])
def delete_storage_location(
    household_id: UUID,
    location_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[None]:
    existing = storage_service.get_storage_location(household_id, location_id)
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Storage location not found")
    storage_service.delete_storage_location(household_id, location_id)
    return ok(None)
