from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.ledger_entry import LedgerBalance, LedgerEntryDetail, Settlement
from app.schemas.member import Member
from app.schemas.settlement import RecordSettlementRequest, SettlementRecord
from app.services import ledger as ledger_service
from app.services import settlements as settlements_service

router = APIRouter(prefix="/households/{household_id}/ledger", tags=["ledger"])


@router.get("/entries", response_model=Envelope[list[LedgerEntryDetail]])
def list_ledger_entries(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[LedgerEntryDetail]]:
    return ok(ledger_service.list_entries_detailed(household_id))


@router.get("/balances", response_model=Envelope[list[LedgerBalance]])
def get_ledger_balances(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[LedgerBalance]]:
    return ok(ledger_service.compute_balances(household_id))


@router.get("/settlements", response_model=Envelope[list[Settlement]])
def get_ledger_settlements(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[Settlement]]:
    """The computed minimal-transfer settle-up plan -- what *would* clear
    every balance. Distinct from settlement-records below, which are
    payments that actually happened."""
    return ok(ledger_service.compute_settlements(household_id))


@router.get("/settlement-records", response_model=Envelope[list[SettlementRecord]])
def list_settlement_records(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[SettlementRecord]]:
    """Every recorded payment, newest first -- reversal rows included, so
    the client can strike through a reversed original and hide the reversal
    itself."""
    return ok(settlements_service.list_records(household_id))


@router.post("/settlement-records", response_model=Envelope[SettlementRecord])
def record_settlement(
    household_id: UUID,
    body: RecordSettlementRequest,
    caller: Member = Depends(require_household_membership),
) -> Envelope[SettlementRecord]:
    try:
        record = settlements_service.record_settlement(household_id, caller, body)
    except settlements_service.MemberNotInHouseholdError as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "payer and payee must both be members of this household",
        ) from exc
    return ok(record)


@router.delete("/settlement-records/{settlement_id}", response_model=Envelope[SettlementRecord])
def reverse_settlement(
    household_id: UUID,
    settlement_id: UUID,
    caller: Member = Depends(require_household_membership),
) -> Envelope[SettlementRecord]:
    """ "Delete" a recorded payment. Nothing is actually deleted -- this
    appends a reversing row (parties swapped) that cancels the original in
    the balance math and leaves the audit trail intact. Returns the
    reversal row."""
    try:
        reversal = settlements_service.reverse_settlement(household_id, caller, settlement_id)
    except settlements_service.SettlementNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Settlement not found") from exc
    except settlements_service.AlreadyReversedError as exc:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "That settlement has already been reversed"
        ) from exc
    return ok(reversal)
