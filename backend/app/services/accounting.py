from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.ledger_entry import LedgerEntryReason


def compute_item_shares(
    total_quantity: Decimal,
    total_cost: Decimal,
    member_ids: list[UUID],
    buyer_id: UUID,
    usage_by_member: dict[UUID, Decimal | None],
) -> dict[UUID, Decimal]:
    """The one split rule for a shared item, replacing the old
    SHARED_CONSUMABLE (always equal) / UNIT_BASED (equal + incremental
    overage) split with a single unified allotment-cascade: everyone gets an
    equal allotment of the total quantity; anyone whose *documented* usage
    exceeds their current round's allotment pays for exactly what they used
    and drops out of the pool; the allotment for whoever's left recomputes
    from what remains, repeating until stable. Undocumented usage
    (`usage_by_member[m] is None`, or `m` simply missing from the dict)
    always settles at whatever the final allotment works out to -- there's
    no data to compare it against, so it's never a candidate to lock.

    Deliberately order-independent: every round locks *all* members over
    that round's shared threshold at once, rather than processing them one
    at a time, so who gets checked first never changes the result -- two
    people going over simultaneously locks both together, not one-then-the-
    other with a different number in between.

    `member_ids` must include the buyer (they still occupy a slot for
    allotment-sizing purposes, and can still "lock" on real usage the same
    as anyone else -- what they eat is real quantity gone, same as anyone
    else's overage, and needs to reduce what's left for the rest). The
    buyer is simply never billed for their own purchase, so they're
    stripped from the *returned* dict at the very end regardless of what
    they settled at.

    Returns {member_id: amount_owed} for every non-buyer member. Amounts
    are exact Decimal fractions, never pre-rounded -- ledger_entries.amount
    is deliberately unconstrained-scale for the same reason (rounding only
    ever happens at display/settle time, never here).
    """
    if total_quantity <= 0 or not member_ids:
        return {}

    unit_cost = total_cost / total_quantity
    pool: set[UUID] = set(member_ids)
    remaining_quantity = total_quantity
    locked_quantity: dict[UUID, Decimal] = {}

    while pool:
        allotment = remaining_quantity / len(pool)
        over_this_round = [
            member_id
            for member_id in pool
            if usage_by_member.get(member_id) is not None
            and usage_by_member[member_id] > allotment  # type: ignore[operator]
        ]
        if not over_this_round:
            for member_id in pool:
                locked_quantity[member_id] = allotment
            break

        for member_id in over_this_round:
            used = usage_by_member[member_id]
            assert used is not None
            locked_quantity[member_id] = used
            remaining_quantity -= used
            pool.discard(member_id)

    return {
        member_id: locked_quantity[member_id] * unit_cost
        for member_id in member_ids
        if member_id != buyer_id
    }


def freeze_item_debt(item_id: UUID) -> None:
    """Called once an item leaves ACTIVE (see inventory_items.py's consume()
    and discard()) -- computes each non-buyer member's final share from
    whatever consumption_events actually happened, posts it as a real,
    permanent PURCHASE ledger entry, and marks the item frozen. Idempotent:
    no-ops if debt_frozen_at is already set, so it's safe to call from
    multiple status-changing code paths without double-billing.
    """
    client = get_service_client()
    item = (
        client.table("inventory_items")
        .select(
            "id, household_id, purchase_event_id, total_quantity, cost, "
            "accounting_type, debt_frozen_at"
        )
        .eq("id", str(item_id))
        .maybe_single()
        .execute()
    )
    if not item or not item.data or item.data["debt_frozen_at"] is not None:
        return
    row = item.data
    # PERSONAL items never touch the ledger at all -- nothing to freeze, and
    # debt_frozen_at deliberately stays null for them forever, so they're
    # always in the freely-editable bucket everywhere else that checks it.
    if row["accounting_type"] == "PERSONAL":
        return

    purchase_event = (
        client.table("purchase_events")
        .select("member_id")
        .eq("id", row["purchase_event_id"])
        .single()
        .execute()
    )
    buyer_id = UUID(purchase_event.data["member_id"])

    allowed = (
        client.table("inventory_item_allowed_members")
        .select("member_id")
        .eq("inventory_item_id", str(item_id))
        .execute()
    )
    member_ids = [UUID(r["member_id"]) for r in allowed.data]

    consumption = (
        client.table("consumption_events")
        .select("member_id, quantity_used")
        .eq("inventory_item_id", str(item_id))
        .execute()
    )
    usage_by_member: dict[UUID, Decimal | None] = {}
    for row_ in consumption.data:
        member_id = UUID(row_["member_id"])
        used = Decimal(str(row_["quantity_used"]))
        usage_by_member[member_id] = (usage_by_member.get(member_id) or Decimal(0)) + used

    shares = compute_item_shares(
        total_quantity=Decimal(str(row["total_quantity"])),
        total_cost=Decimal(str(row["cost"])),
        member_ids=member_ids,
        buyer_id=buyer_id,
        usage_by_member=usage_by_member,
    )

    entries = [
        {
            "household_id": row["household_id"],
            "creditor_member_id": str(buyer_id),
            "debtor_member_id": str(member_id),
            "amount": str(amount),
            "reason": LedgerEntryReason.PURCHASE.value,
            "source_purchase_event_id": row["purchase_event_id"],
        }
        for member_id, amount in shares.items()
        if amount > 0
    ]
    if entries:
        client.table("ledger_entries").insert(entries).execute()

    client.table("inventory_items").update(
        {"debt_frozen_at": datetime.now(UTC).isoformat()}
    ).eq("id", str(item_id)).execute()
