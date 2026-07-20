from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class Household(BaseModel):
    id: UUID
    name: str
    address: str | None
    join_code: str
    created_by_user_id: UUID
    created_at: datetime
    updated_at: datetime


class CreateHouseholdRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    nickname: str = Field(min_length=1, max_length=100)


class JoinHouseholdRequest(BaseModel):
    join_code: str = Field(min_length=8, max_length=8)
    nickname: str = Field(min_length=1, max_length=100)
