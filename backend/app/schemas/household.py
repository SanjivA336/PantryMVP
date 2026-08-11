from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.units import UnitSystem


class Household(BaseModel):
    id: UUID
    name: str
    address: str | None
    join_code: str
    # The current owner -- distinct from who originally created the
    # household, since ownership is transferable (see
    # services/households.py's transfer_ownership). Owning a household is
    # what blocks a user from deleting their own account, so this can never
    # go null: the column is ON DELETE RESTRICT against public.users.
    owner_id: UUID
    # The default unit system offered when adding a food this household
    # hasn't tracked before -- a per-food choice (see household_food_variants)
    # always wins once one's been made.
    preferred_unit_system: UnitSystem
    created_at: datetime
    updated_at: datetime


class CreateHouseholdRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    address: str | None = None
    nickname: str = Field(min_length=1, max_length=100)


class JoinHouseholdRequest(BaseModel):
    join_code: str = Field(min_length=8, max_length=8)
    nickname: str = Field(min_length=1, max_length=100)


class UpdateHouseholdRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    address: str | None = None
    preferred_unit_system: UnitSystem | None = None


class TransferOwnershipRequest(BaseModel):
    new_owner_member_id: UUID
