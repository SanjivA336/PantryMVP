from uuid import UUID

from postgrest.exceptions import APIError

from app.core.supabase import get_service_client
from app.schemas.activity import ActivityType
from app.schemas.member import Member
from app.schemas.settlement import RecordSettlementRequest, SettlementRecord
from app.services import activity as activity_service
from app.services import members as members_service

_TABLE = "settlement_records"


class SettlementNotFoundError(Exception):
    pass


class AlreadyReversedError(Exception):
    """A settlement can be reversed at most once, and a reversal row can't
    itself be reversed -- both cases raise this."""


class MemberNotInHouseholdError(Exception):
    def __init__(self, member_id: UUID) -> None:
        self.member_id = member_id


def _nickname_map(household_id: UUID) -> dict[UUID, str]:
    return {m.id: m.nickname for m in members_service.list_members(household_id)}


def list_records(household_id: UUID) -> list[SettlementRecord]:
    """Every settlement row, newest first -- reversals included. The feed
    and the history modal filter reversal rows out for display; the balance
    math (settlement_deltas) needs all of them."""
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .order("created_at", desc=True)
        .execute()
    )
    return [SettlementRecord(**row) for row in result.data]


def record_settlement(
    household_id: UUID, recorded_by: Member, body: RecordSettlementRequest
) -> SettlementRecord:
    nicknames = _nickname_map(household_id)
    for member_id in (body.payer_member_id, body.payee_member_id):
        if member_id not in nicknames:
            raise MemberNotInHouseholdError(member_id)

    client = get_service_client()
    inserted = (
        client.table(_TABLE)
        .insert(
            {
                "household_id": str(household_id),
                "payer_member_id": str(body.payer_member_id),
                "payee_member_id": str(body.payee_member_id),
                "amount": str(body.amount),
                "note": body.note,
                "recorded_by_member_id": str(recorded_by.id),
            }
        )
        .execute()
    )
    record = SettlementRecord(**inserted.data[0])

    activity_service.record(
        household_id,
        ActivityType.SETTLEMENT_RECORDED,
        actor=recorded_by,
        subject_name=None,
        detail={
            "payer": nicknames[body.payer_member_id],
            "payee": nicknames[body.payee_member_id],
            "amount": str(body.amount),
            "note": body.note,
        },
    )
    return record


def reverse_settlement(
    household_id: UUID, recorded_by: Member, settlement_id: UUID
) -> SettlementRecord:
    client = get_service_client()
    existing = (
        client.table(_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .eq("id", str(settlement_id))
        .maybe_single()
        .execute()
    )
    if not existing or not existing.data:
        raise SettlementNotFoundError
    target = SettlementRecord(**existing.data)

    # A reversal row can't itself be reversed (immutable flag, no race). The
    # "already has a reversal" check is best-effort here -- the real guard
    # against a concurrent double-reverse is the partial UNIQUE index on
    # reverses_settlement_id (migration 0029), caught below.
    if target.reverses_settlement_id is not None:
        raise AlreadyReversedError
    already = (
        client.table(_TABLE).select("id").eq("reverses_settlement_id", str(settlement_id)).execute()
    )
    if already.data:
        raise AlreadyReversedError

    try:
        inserted = (
            client.table(_TABLE)
            .insert(
                {
                    "household_id": str(household_id),
                    # Parties swapped: the reversal represents payee paying
                    # payer back, which nets exactly against the original.
                    "payer_member_id": str(target.payee_member_id),
                    "payee_member_id": str(target.payer_member_id),
                    "amount": str(target.amount),
                    "note": target.note,
                    "recorded_by_member_id": str(recorded_by.id),
                    "reverses_settlement_id": str(settlement_id),
                }
            )
            .execute()
        )
    except APIError as exc:
        # Lost a concurrent double-reverse: the unique index rejected the
        # second reversal row.
        raise AlreadyReversedError from exc
    reversal = SettlementRecord(**inserted.data[0])

    nicknames = _nickname_map(household_id)
    activity_service.record(
        household_id,
        ActivityType.SETTLEMENT_REVERSED,
        actor=recorded_by,
        subject_name=None,
        detail={
            "payer": nicknames.get(target.payer_member_id, "a former member"),
            "payee": nicknames.get(target.payee_member_id, "a former member"),
            "amount": str(target.amount),
            "original_id": str(settlement_id),
        },
    )
    return reversal
