from collections import defaultdict
from decimal import Decimal
from uuid import UUID

from app.core.supabase import get_service_client
from app.schemas.ledger_entry import LedgerBalance, LedgerEntry, LedgerEntryDetail, Settlement
from app.services import accounting as accounting_service

_TABLE = "ledger_entries"

# Reused for both the purchase-event and consumption-event item lookups
# below -- same food-name resolution inventory_items.py's own _flatten()
# does, just without needing the rest of an InventoryItem's fields.
_ITEM_NAME_SELECT = (
    "id, purchase_event_id, name_override, household_food_variants(global_food_definitions(name))"
)


def _item_display_name(row: dict) -> str:
    variant = row.get("household_food_variants") or {}
    food = variant.get("global_food_definitions") or {}
    return row.get("name_override") or food.get("name") or "Unknown item"


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


def list_entries_detailed(household_id: UUID) -> list[LedgerEntryDetail]:
    """Same rows as list_entries, plus a resolved food_name per entry.
    ledger_entries has no direct item reference, only source_purchase_event_id
    (PURCHASE entries) or source_consumption_event_id (OVERAGE entries) --
    each gets joined through to the inventory item it's attached to. Two
    batched lookups rather than N+1 per-entry queries.
    """
    client = get_service_client()
    entries = (
        client.table(_TABLE)
        .select("*")
        .eq("household_id", str(household_id))
        .order("created_at", desc=True)
        .execute()
    ).data

    purchase_event_ids = {
        e["source_purchase_event_id"] for e in entries if e["source_purchase_event_id"]
    }
    name_by_purchase_event: dict[str, str] = {}
    if purchase_event_ids:
        rows = (
            client.table("inventory_items")
            .select(_ITEM_NAME_SELECT)
            .in_("purchase_event_id", list(purchase_event_ids))
            .execute()
        ).data
        for row in rows:
            name_by_purchase_event[row["purchase_event_id"]] = _item_display_name(row)

    consumption_event_ids = {
        e["source_consumption_event_id"] for e in entries if e["source_consumption_event_id"]
    }
    name_by_consumption_event: dict[str, str] = {}
    if consumption_event_ids:
        consumption_rows = (
            client.table("consumption_events")
            .select("id, inventory_item_id")
            .in_("id", list(consumption_event_ids))
            .execute()
        ).data
        item_ids = {row["inventory_item_id"] for row in consumption_rows}
        name_by_item_id: dict[str, str] = {}
        if item_ids:
            item_rows = (
                client.table("inventory_items")
                .select(_ITEM_NAME_SELECT)
                .in_("id", list(item_ids))
                .execute()
            ).data
            for row in item_rows:
                name_by_item_id[row["id"]] = _item_display_name(row)
        for row in consumption_rows:
            name = name_by_item_id.get(row["inventory_item_id"])
            if name:
                name_by_consumption_event[row["id"]] = name

    detailed: list[LedgerEntryDetail] = []
    for row in entries:
        food_name = None
        if row["source_purchase_event_id"]:
            food_name = name_by_purchase_event.get(row["source_purchase_event_id"])
        elif row["source_consumption_event_id"]:
            food_name = name_by_consumption_event.get(row["source_consumption_event_id"])
        detailed.append(LedgerEntryDetail(**row, food_name=food_name))

    return detailed


def _ghost_member_ids(household_id: UUID) -> set[UUID]:
    """Members whose underlying account has been deleted (user_id null,
    left behind by the ON DELETE SET NULL on members.user_id -- see the
    account-deletion writeup) -- distinct from a merely-kicked/left member,
    whose account still exists and might still settle up outside the app.
    Excluded from balances/settlements below since there's no one left to
    pay or be paid; the raw ledger history (list_entries*) is untouched.
    """
    client = get_service_client()
    result = (
        client.table("members")
        .select("id")
        .eq("household_id", str(household_id))
        .is_("user_id", "null")
        .execute()
    )
    return {UUID(row["id"]) for row in result.data}


def _live_shares(household_id: UUID) -> list[tuple[UUID, UUID, Decimal]]:
    """(debtor, creditor, amount) triples for every item whose debt hasn't
    frozen yet (debt_frozen_at is null) -- computed live from whatever
    consumption_events exist right now, via the same compute_item_shares
    rule freeze_item_debt uses once, for real, at freeze time. Never
    posted anywhere; recomputed fresh on every call, so it always reflects
    the current state of the world and never drifts from it.

    Batched across the whole household (one query per related table, not
    one per item) since a household can easily have a dozen+ live items at
    once.
    """
    client = get_service_client()
    items = (
        client.table("inventory_items")
        .select("id, purchase_event_id, total_quantity, cost")
        .eq("household_id", str(household_id))
        .eq("accounting_type", "SHARED")
        .is_("debt_frozen_at", "null")
        .execute()
    ).data
    if not items:
        return []

    item_ids = [row["id"] for row in items]
    purchase_event_ids = list({row["purchase_event_id"] for row in items})

    purchase_events = (
        client.table("purchase_events")
        .select("id, member_id")
        .in_("id", purchase_event_ids)
        .execute()
    ).data
    buyer_by_purchase_event = {row["id"]: UUID(row["member_id"]) for row in purchase_events}

    allowed = (
        client.table("inventory_item_allowed_members")
        .select("inventory_item_id, member_id")
        .in_("inventory_item_id", item_ids)
        .execute()
    ).data
    members_by_item: dict[str, list[UUID]] = defaultdict(list)
    for row in allowed:
        members_by_item[row["inventory_item_id"]].append(UUID(row["member_id"]))

    consumption = (
        client.table("consumption_events")
        .select("inventory_item_id, member_id, quantity_used")
        .in_("inventory_item_id", item_ids)
        .execute()
    ).data
    usage_by_item: dict[str, dict[UUID, Decimal]] = defaultdict(dict)
    for row in consumption:
        item_id = row["inventory_item_id"]
        member_id = UUID(row["member_id"])
        used = Decimal(str(row["quantity_used"]))
        usage_by_item[item_id][member_id] = usage_by_item[item_id].get(member_id, Decimal(0)) + used

    triples: list[tuple[UUID, UUID, Decimal]] = []
    for row in items:
        buyer_id = buyer_by_purchase_event.get(row["purchase_event_id"])
        member_ids = members_by_item.get(row["id"], [])
        if buyer_id is None or not member_ids:
            continue
        usage_by_member: dict[UUID, Decimal | None] = dict(usage_by_item.get(row["id"], {}))
        shares = accounting_service.compute_item_shares(
            total_quantity=Decimal(str(row["total_quantity"])),
            total_cost=Decimal(str(row["cost"])),
            member_ids=member_ids,
            buyer_id=buyer_id,
            usage_by_member=usage_by_member,
        )
        triples.extend(
            (debtor_id, buyer_id, amount) for debtor_id, amount in shares.items() if amount > 0
        )

    return triples


def _recorded_settlement_deltas(household_id: UUID) -> list[tuple[UUID, UUID, Decimal]]:
    """(payer, payee, amount) for every settlement_records row, reversals
    included -- a reversal is just a row with the parties swapped, so
    applying the same "payer paid payee" rule to it cancels its original
    with no special-casing.

    Read here directly rather than through settlements_service so it rides
    the same get_service_client the rest of this module's balance math
    uses (and stays trivially fake-able in the balance unit tests).
    """
    client = get_service_client()
    result = (
        client.table("settlement_records")
        .select("payer_member_id, payee_member_id, amount")
        .eq("household_id", str(household_id))
        .execute()
    )
    return [
        (UUID(r["payer_member_id"]), UUID(r["payee_member_id"]), Decimal(str(r["amount"])))
        for r in result.data
    ]


def compute_balances(household_id: UUID) -> list[LedgerBalance]:
    """Net, pairwise balances across three blended sources: every posted
    ledger entry, every not-yet-frozen item's live computed share (see
    _live_shares), and every recorded settlement (see
    settlements_service.settlement_deltas) -- all folded into one net dict,
    indistinguishable to the caller. That's the point: an active item's
    debt should look exactly as real as an already-frozen one, and a
    payment someone logged should cancel debt exactly as if the ledger
    entries it covered had never been posted.

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
        .execute()
    )
    ghost_ids = _ghost_member_ids(household_id)

    # net[(debtor, creditor)] = total debtor owes creditor, before netting
    # the reverse direction away.
    net: dict[tuple[UUID, UUID], Decimal] = defaultdict(lambda: Decimal(0))
    for row in result.data:
        debtor = UUID(row["debtor_member_id"])
        creditor = UUID(row["creditor_member_id"])
        if debtor in ghost_ids or creditor in ghost_ids:
            continue
        net[(debtor, creditor)] += Decimal(str(row["amount"]))

    for debtor, creditor, amount in _live_shares(household_id):
        if debtor in ghost_ids or creditor in ghost_ids:
            continue
        net[(debtor, creditor)] += amount

    # A recorded payment from payer to payee reduces what payer owes payee.
    # Modeled as debt in the opposite direction (payee "owes" payer that
    # much), so after the forward/reverse netting below it cancels cleanly.
    for payer, payee, amount in _recorded_settlement_deltas(household_id):
        if payer in ghost_ids or payee in ghost_ids:
            continue
        net[(payee, payer)] += amount

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


def compute_settlements(household_id: UUID) -> list[Settlement]:
    """A minimal-transfer settle-up plan: collapses the whole group's net
    positions (not just pairwise ones -- three people in a $10 cycle have
    three nonzero pairwise balances but a zero net each, needing no
    transfers at all) and greedily matches the largest creditor against the
    largest debtor until everyone's back to zero. This is the standard
    debt-simplification heuristic (what tools like Splitwise use): not
    proven globally optimal in the worst case, but it's guaranteed to fully
    resolve at least one person per step, so it never produces more than
    (people with a nonzero net - 1) transactions.
    """
    balances = compute_balances(household_id)

    net: dict[UUID, Decimal] = defaultdict(lambda: Decimal(0))
    for balance in balances:
        net[balance.creditor_member_id] += balance.amount
        net[balance.debtor_member_id] -= balance.amount

    creditors = sorted(
        ((member_id, amount) for member_id, amount in net.items() if amount > 0),
        key=lambda pair: pair[1],
        reverse=True,
    )
    debtors = sorted(
        ((member_id, -amount) for member_id, amount in net.items() if amount < 0),
        key=lambda pair: pair[1],
        reverse=True,
    )

    settlements: list[Settlement] = []
    i, j = 0, 0
    while i < len(creditors) and j < len(debtors):
        creditor_id, credit_amount = creditors[i]
        debtor_id, debt_amount = debtors[j]
        transfer = min(credit_amount, debt_amount)
        settlements.append(
            Settlement(debtor_member_id=debtor_id, creditor_member_id=creditor_id, amount=transfer)
        )
        credit_amount -= transfer
        debt_amount -= transfer
        creditors[i] = (creditor_id, credit_amount)
        debtors[j] = (debtor_id, debt_amount)
        if credit_amount == 0:
            i += 1
        if debt_amount == 0:
            j += 1

    return settlements
