import logging
from datetime import datetime
from typing import Any
from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.activity import ActivityEvent, ActivityType
from app.schemas.member import Member

_TABLE = "household_activity"
_logger = logging.getLogger(__name__)


def record(
    household_id: UUID,
    type_: ActivityType,
    *,
    actor: Member | None = None,
    subject_name: str | None = None,
    detail: dict[str, Any] | None = None,
) -> None:
    """Append one event to a household's activity feed.

    Best-effort by design: this runs as a side effect of a real operation
    (a consume, a settlement, a member leaving) that has already succeeded
    by the time it's called, so a feed hiccup must never turn that
    operation into a 500. Any failure is logged and swallowed.

    actor_nickname / subject_name are frozen into the row here rather than
    joined at read time -- an activity log should read the way it did when
    it happened, and the feed shouldn't need a join per row to render.
    """
    try:
        client = get_service_client()
        client.table(_TABLE).insert(
            {
                "household_id": str(household_id),
                "type": type_.value,
                "actor_member_id": str(actor.id) if actor else None,
                "actor_nickname": actor.nickname if actor else None,
                "subject_name": subject_name,
                "detail": detail or {},
            }
        ).execute()
    except Exception:
        _logger.exception(
            "failed to record activity event %s for household %s", type_.value, household_id
        )


def list_feed(
    household_id: UUID,
    *,
    types: list[ActivityType] | None = None,
    limit: int = 50,
    before: datetime | None = None,
) -> list[ActivityEvent]:
    """Newest-first slice of the feed. `before` is a plain keyset cursor on
    created_at (pass the oldest row's created_at back to page further);
    `types` narrows to a subset, backed by the (household_id, type,
    created_at) index."""
    client = get_service_client()
    query = client.table(_TABLE).select("*").eq("household_id", str(household_id))
    if types:
        query = query.in_("type", [t.value for t in types])
    if before is not None:
        query = query.lt("created_at", before.isoformat())
    result = query.order("created_at", desc=True).limit(limit).execute()
    return [ActivityEvent(**row) for row in result.data]
