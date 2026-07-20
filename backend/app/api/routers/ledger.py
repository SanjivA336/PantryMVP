from uuid import UUID

from fastapi import APIRouter, Depends

from app.core.auth import require_household_membership
from app.core.responses import Envelope, ok
from app.schemas.ledger_entry import LedgerBalance, LedgerEntry
from app.schemas.member import Member
from app.services import ledger as ledger_service

router = APIRouter(prefix="/households/{household_id}/ledger", tags=["ledger"])


@router.get("/entries", response_model=Envelope[list[LedgerEntry]])
def list_ledger_entries(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[LedgerEntry]]:
    return ok(ledger_service.list_entries(household_id))


@router.get("/balances", response_model=Envelope[list[LedgerBalance]])
def get_ledger_balances(
    household_id: UUID,
    _member: Member = Depends(require_household_membership),
) -> Envelope[list[LedgerBalance]]:
    return ok(ledger_service.compute_balances(household_id))
