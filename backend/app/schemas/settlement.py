from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field


class RecordSettlementRequest(BaseModel):
    """A real "payer paid payee $amount" event the user is logging after the
    fact -- not necessarily equal to any single suggested transfer (see
    ledger's GET /settlements for those). Any active member can record one;
    the recorder is stamped server-side from the caller."""

    payer_member_id: UUID
    payee_member_id: UUID
    amount: Decimal = Field(gt=0)
    note: str | None = Field(default=None, max_length=500)


class SettlementRecord(BaseModel):
    id: UUID
    household_id: UUID
    payer_member_id: UUID
    payee_member_id: UUID
    amount: Decimal
    note: str | None
    recorded_by_member_id: UUID
    # Set only on a reversal row (parties swapped) that undoes the
    # settlement it points at. A row with this set is bookkeeping -- the
    # feed and the history list hide it and mark the original "reversed"
    # instead.
    reverses_settlement_id: UUID | None
    created_at: datetime
