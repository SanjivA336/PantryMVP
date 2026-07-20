from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel


class LedgerEntryReason(StrEnum):
    PURCHASE = "PURCHASE"
    OVERAGE = "OVERAGE"
    ADJUSTMENT = "ADJUSTMENT"


class LedgerEntry(BaseModel):
    id: UUID
    household_id: UUID
    creditor_member_id: UUID
    debtor_member_id: UUID
    amount: Decimal
    reason: LedgerEntryReason
    source_purchase_event_id: UUID | None
    source_consumption_event_id: UUID | None
    settled_at: datetime | None
    created_at: datetime


class LedgerBalance(BaseModel):
    """A single net-owed relationship after cross-pair netting: debtor
    owes creditor amount. Only unsettled entries feed this; only pairs
    with a nonzero net (after both directions cancel out) are included."""

    debtor_member_id: UUID
    creditor_member_id: UUID
    amount: Decimal
