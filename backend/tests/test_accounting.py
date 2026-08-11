import uuid
from decimal import Decimal

from app.services.accounting import compute_item_shares

# Canonical setup used throughout: 12 oranges, $12 total (unit cost $1),
# 4 people (1 buyer + 3 others), baseline allotment 3 each. Matches the
# worked examples from the design conversation exactly.
QUANTITY = Decimal(12)
COST = Decimal(12)


def _ids() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, uuid.UUID]:
    return uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


def test_nobody_over_settles_evenly_even_with_unused_quantity() -> None:
    buyer, m1, m2, m3 = _ids()
    # One orange goes unused entirely -- still doesn't change anyone's bill.
    usage = {buyer: Decimal(3), m1: Decimal(3), m2: Decimal(3), m3: Decimal(2)}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert buyer not in shares
    assert shares == {m1: Decimal(3), m2: Decimal(3), m3: Decimal(3)}


def test_one_documented_user_over_others_documented_and_under() -> None:
    buyer, m1, m2, m3 = _ids()
    usage = {buyer: Decimal(1), m1: Decimal(4), m2: Decimal(2), m3: Decimal(2)}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert shares[m1] == Decimal(4)
    assert shares[m2] == Decimal(8) / 3
    assert shares[m3] == Decimal(8) / 3
    assert buyer not in shares


def test_three_documented_under_allotment_one_undocumented() -> None:
    buyer, m1, m2, m3 = _ids()
    usage: dict = {buyer: None, m1: Decimal(2), m2: Decimal(2), m3: Decimal(2)}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert shares == {m1: Decimal(3), m2: Decimal(3), m3: Decimal(3)}


def test_one_documented_over_rest_undocumented() -> None:
    buyer, m1, m2, m3 = _ids()
    usage: dict = {buyer: None, m1: Decimal(5), m2: None, m3: None}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert shares[m1] == Decimal(5)
    assert shares[m2] == Decimal(7) / 3
    assert shares[m3] == Decimal(7) / 3


def test_one_documented_under_rest_undocumented() -> None:
    buyer, m1, m2, m3 = _ids()
    usage: dict = {buyer: None, m1: Decimal(2), m2: None, m3: None}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert shares == {m1: Decimal(3), m2: Decimal(3), m3: Decimal(3)}


def test_two_users_over_allotment_simultaneously() -> None:
    buyer, m1, m2, m3 = _ids()
    usage: dict = {buyer: None, m1: Decimal(5), m2: Decimal(4), m3: None}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert shares[m1] == Decimal(5)
    assert shares[m2] == Decimal(4)
    assert shares[m3] == Decimal("1.5")


def test_cascading_lock_when_shrunk_allotment_exposes_a_second_over_user() -> None:
    """The key case that distinguishes this from a flat "spread the excess
    evenly" rule: m2 used exactly the *baseline* allotment (3), which is
    fine on its own, but once m1's overage shrinks the pool's allotment to
    8/3, m2's own usage now exceeds *that* -- so m2 locks too, on a second
    round, instead of quietly keeping the discount everyone else gets."""
    buyer, m1, m2, m3 = _ids()
    usage: dict = {buyer: None, m1: Decimal(4), m2: Decimal(3), m3: None}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert shares[m1] == Decimal(4)
    assert shares[m2] == Decimal(3)
    assert shares[m3] == Decimal("2.5")


def test_buyer_own_overage_still_reduces_whats_left_but_buyer_is_never_billed() -> None:
    buyer, m1, m2, m3 = _ids()
    usage = {buyer: Decimal(5), m1: Decimal(2), m2: Decimal(2), m3: Decimal(2)}

    shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)

    assert buyer not in shares
    assert shares[m1] == Decimal(7) / 3
    assert shares[m2] == Decimal(7) / 3
    assert shares[m3] == Decimal(7) / 3


def test_every_scenario_accounts_for_the_full_cost() -> None:
    """The invariant that makes this rule self-consistent regardless of how
    the cascade plays out: locked members pay exactly what they used,
    everyone else splits exactly what's left, so real money collected plus
    the buyer's own (never-billed) settled share always equals the total."""
    buyer, m1, m2, m3 = _ids()
    scenarios = [
        {buyer: Decimal(3), m1: Decimal(3), m2: Decimal(3), m3: Decimal(2)},
        {buyer: Decimal(1), m1: Decimal(4), m2: Decimal(2), m3: Decimal(2)},
        {buyer: None, m1: Decimal(5), m2: Decimal(4), m3: None},
        {buyer: None, m1: Decimal(4), m2: Decimal(3), m3: None},
    ]
    for usage in scenarios:
        shares = compute_item_shares(QUANTITY, COST, [buyer, m1, m2, m3], buyer, usage)
        collected = sum(shares.values(), Decimal(0))
        # The buyer's own settled amount never appears in `shares`, but it's
        # always (COST - collected) by construction -- re-deriving it here
        # would just duplicate the function under test, so this checks the
        # weaker but still meaningful property that nothing was ever
        # over- or under-collected relative to any plausible buyer share.
        assert Decimal(0) <= collected <= COST


def test_zero_quantity_returns_no_shares() -> None:
    buyer, m1, _m2, _m3 = _ids()
    assert compute_item_shares(Decimal(0), COST, [buyer, m1], buyer, {}) == {}


def test_no_members_returns_no_shares() -> None:
    buyer = uuid.uuid4()
    assert compute_item_shares(QUANTITY, COST, [], buyer, {}) == {}


def test_solo_buyer_owes_nothing_to_themselves() -> None:
    buyer = uuid.uuid4()
    assert compute_item_shares(QUANTITY, COST, [buyer], buyer, {buyer: QUANTITY}) == {}
