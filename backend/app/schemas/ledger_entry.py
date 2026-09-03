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
    created_at: datetime


class LedgerEntryDetail(LedgerEntry):
    # Resolved via a join through purchase_events/consumption_events to the
    # inventory item they're attached to -- null only for ADJUSTMENT entries
    # (no source event at all) or the rare case the source item itself no
    # longer resolves to a name.
    food_name: str | None = None


class LedgerBalance(BaseModel):
    """A single net-owed relationship after cross-pair netting: debtor
    owes creditor amount. Only unsettled entries feed this; only pairs
    with a nonzero net (after both directions cancel out) are included."""

    debtor_member_id: UUID
    creditor_member_id: UUID
    amount: Decimal


class Settlement(BaseModel):
    """One transfer in a minimal settle-up plan -- distinct from
    LedgerBalance despite the identical shape: a balance is a raw pairwise
    relationship, a settlement is one step of a group-wide simplification
    (see compute_settlements) that may not correspond to any single
    balance at all (e.g. a 3-person debt cycle nets to zero settlements
    even though every pairwise balance is nonzero)."""

    debtor_member_id: UUID
    creditor_member_id: UUID
    amount: Decimal
