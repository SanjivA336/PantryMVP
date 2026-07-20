from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.ledger_entry import LedgerBalance, LedgerEntry

_TABLE = "ledger_entries"


def list_entries(household_id: UUID) -> list[LedgerEntry]:
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .order("created_at", desc=True)
        .execute()
    )
    return [LedgerEntry(**row) for row in result.data]


def compute_balances(household_id: UUID) -> list[LedgerBalance]:
    """Net, pairwise balances across all currently-unsettled entries.

    Computed here in Python over the raw rows rather than as a SQL view:
    the netting (collapsing "A owes B $5" and "B owes A $3" into one "A
    owes B $2" row) isn't naturally expressible as a simple aggregate, and
    keeping it out of the database means it stays easy to unit test.
    """
    client = get_service_client()
    result = (
        client.table(_TABLE)
        .select("creditor_member_id, debtor_member_id, amount")
        .eq("household_id", str(household_id))
        .is_("settled_at", "null")
        .execute()
    )

    # net[(debtor, creditor)] = total debtor owes creditor, before netting
    # the reverse direction away.
    net: dict[tuple[UUID, UUID], Decimal] = defaultdict(lambda: Decimal(0))
    for row in result.data:
        debtor = UUID(row["debtor_member_id"])
        creditor = UUID(row["creditor_member_id"])
        net[(debtor, creditor)] += Decimal(str(row["amount"]))

    seen_pairs: set[frozenset[UUID]] = set()
    balances: list[LedgerBalance] = []
    for debtor, creditor in net:
        pair = frozenset((debtor, creditor))
        if pair in seen_pairs:
            continue
        seen_pairs.add(pair)

        forward = net.get((debtor, creditor), Decimal(0))
        reverse = net.get((creditor, debtor), Decimal(0))
        if forward > reverse:
            balances.append(
                LedgerBalance(
                    debtor_member_id=debtor, creditor_member_id=creditor, amount=forward - reverse
                )
            )
        elif reverse > forward:
            balances.append(
                LedgerBalance(
                    debtor_member_id=creditor, creditor_member_id=debtor, amount=reverse - forward
                )
            )
        # Equal: fully netted, no balance remains between this pair.

    return balances
