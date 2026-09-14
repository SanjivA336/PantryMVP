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
            if usage_by_member.get(member_id) is not None and usage_by_member[member_id] > allotment  # type: ignore[operator]
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


def bill_outsider_usage(
    total_quantity: Decimal,
    total_cost: Decimal,
    member_ids: list[UUID],
    usage_by_member: dict[UUID, Decimal | None],
) -> tuple[Decimal, Decimal, dict[UUID, Decimal | None], dict[UUID, Decimal]]:
    """Usage logged by someone outside the item's allowed_member_ids (a
    one-off "sure, go ahead" that still got recorded -- see migration 0036,
    which dropped the hard block on this) is billed at cost for exactly
    what they used, the same way anyone's overage already is: they never
    had a formal allotment to measure against, so the whole amount counts
    as over.

    Pulled out *before* compute_item_shares runs, rather than taught to
    that function directly, so compute_item_shares never has to know
    anyone outside member_ids exists: each outsider's usage and its
    matching slice of quantity/cost are removed from the pool up front, at
    the item's own unit_cost, and the real allowed members split what's
    left exactly as if the outsider's usage had simply never happened to
    the physical item.

    Returns (remaining_quantity, remaining_cost, insider_usage_by_member,
    outsider_shares) -- pass the first three straight into
    compute_item_shares, then merge outsider_shares into its result.
    """
    if total_quantity <= 0:
        return total_quantity, total_cost, usage_by_member, {}

    unit_cost = total_cost / total_quantity
    member_id_set = set(member_ids)
    insider_usage: dict[UUID, Decimal | None] = {}
    outsider_shares: dict[UUID, Decimal] = {}
    outsider_quantity = Decimal(0)

    for member_id, used in usage_by_member.items():
        if member_id in member_id_set:
            insider_usage[member_id] = used
            continue
        if not used or used <= 0:
            continue
        outsider_quantity += used
        outsider_shares[member_id] = outsider_shares.get(member_id, Decimal(0)) + used * unit_cost

    return (
        total_quantity - outsider_quantity,
        total_cost - outsider_quantity * unit_cost,
        insider_usage,
        outsider_shares,
    )


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

    remaining_quantity, remaining_cost, insider_usage, outsider_shares = bill_outsider_usage(
        Decimal(str(row["total_quantity"])), Decimal(str(row["cost"])), member_ids, usage_by_member
    )
    shares = compute_item_shares(
        total_quantity=remaining_quantity,
        total_cost=remaining_cost,
        member_ids=member_ids,
        buyer_id=buyer_id,
        usage_by_member=insider_usage,
    )
    for member_id, amount in outsider_shares.items():
        shares[member_id] = shares.get(member_id, Decimal(0)) + amount

    # Claim the freeze with a compare-and-swap (only-if-still-null) update
    # *before* posting anything -- consume() can end up calling this twice
    # for the same item under real concurrency (two racing requests can each
    # independently observe the post-RPC row as no-longer-ACTIVE, since that
    # read happens outside the RPC's own row lock). Whoever's update actually
    # matches a row won the race and is the only one who gets to post
    # entries; the loser's update matches nothing and it backs off, the same
    # pattern discard() already uses via its `.eq("status", "ACTIVE")` guard.
    claim = (
        client.table("inventory_items")
        .update({"debt_frozen_at": datetime.now(UTC).isoformat()})
        .eq("id", str(item_id))
        .is_("debt_frozen_at", "null")
        .execute()
    )
    if not claim.data:
        return

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
