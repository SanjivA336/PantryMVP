from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, Field


class StorageLocationType(StrEnum):
    FRIDGE = "FRIDGE"
    FREEZER = "FREEZER"
    PANTRY = "PANTRY"
    GARDEN = "GARDEN"
    OTHER = "OTHER"


class StorageLocation(BaseModel):
    id: UUID
    household_id: UUID
    name: str
    type: StorageLocationType
    description: str | None
    created_at: datetime
    updated_at: datetime


class CreateStorageLocationRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: StorageLocationType
    description: str | None = None


class UpdateStorageLocationRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: StorageLocationType | None = None
    description: str | None = None
