from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class ActivityType(StrEnum):
    """Every kind of event the household activity feed records. Mirrored by
    the `activity_type` Postgres enum (migration 0027) and by the frontend's
    own union. This same taxonomy is what per-type notification / digest
    opt-ins will hang off of later."""

    ITEM_ADDED = "ITEM_ADDED"
    ITEM_CONSUMED = "ITEM_CONSUMED"
    # Covers all four ways an item's story ends -- detail["reason"] is one of
    # USED_UP (consumed to zero) / DISCARDED / EXPIRED / LOST.
    ITEM_REMOVED = "ITEM_REMOVED"
    ITEM_MOVED = "ITEM_MOVED"
    COST_CORRECTED = "COST_CORRECTED"
    USAGE_CORRECTED = "USAGE_CORRECTED"
    SETTLEMENT_RECORDED = "SETTLEMENT_RECORDED"
    SETTLEMENT_REVERSED = "SETTLEMENT_REVERSED"
    MEMBER_JOINED = "MEMBER_JOINED"
    MEMBER_LEFT = "MEMBER_LEFT"


class ActivityEvent(BaseModel):
    id: UUID
    household_id: UUID
    type: ActivityType
    # Null when there's no actor worth showing (an item hitting zero on its
    # own) or when the actor's member row was later detached from a deleted
    # account. actor_nickname is captured at write time and stays readable
    # even then.
    actor_member_id: UUID | None
    actor_nickname: str | None
    subject_name: str | None
    detail: dict[str, Any]
    created_at: datetime
