from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class Member(BaseModel):
    id: UUID
    household_id: UUID
    user_id: UUID | None
    nickname: str
    is_admin: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime


class UpdateMemberRequest(BaseModel):
    nickname: str | None = Field(default=None, min_length=1, max_length=100)
    is_admin: bool | None = None
