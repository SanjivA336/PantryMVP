import uuid
from decimal import Decimal

from app.schemas.ledger_entry import LedgerBalance
from app.services import ledger as ledger_service


def _balance(debtor: uuid.UUID, creditor: uuid.UUID, amount: str) -> LedgerBalance:
    return LedgerBalance(
        debtor_member_id=debtor, creditor_member_id=creditor, amount=Decimal(amount)
    )


def _compute(monkeypatch, balances: list[LedgerBalance]):
    monkeypatch.setattr("app.services.ledger.compute_balances", lambda hh: balances)
    return ledger_service.compute_settlements(uuid.uuid4())


def test_simple_two_person_debt_is_one_settlement(monkeypatch) -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    settlements = _compute(monkeypatch, [_balance(a, b, "10.00")])

    assert len(settlements) == 1
    assert settlements[0].debtor_member_id == a
    assert settlements[0].creditor_member_id == b
    assert settlements[0].amount == Decimal("10.00")


def test_three_person_cycle_nets_to_zero_settlements(monkeypatch) -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    # A owes B, B owes C, C owes A, all equal -- everyone's true net is
    # zero even though every pairwise balance is nonzero.
    settlements = _compute(
        monkeypatch,
        [_balance(a, b, "10.00"), _balance(b, c, "10.00"), _balance(c, a, "10.00")],
    )

    assert settlements == []


def test_three_person_case_needing_two_transactions(monkeypatch) -> None:
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    # A owes B $7 and owes C $3 directly -- net: A -10, B +7, C +3.
    settlements = _compute(monkeypatch, [_balance(a, b, "7.00"), _balance(a, c, "3.00")])

    assert len(settlements) == 2
    by_creditor = {s.creditor_member_id: s for s in settlements}
    assert by_creditor[b].debtor_member_id == a
    assert by_creditor[b].amount == Decimal("7.00")
    assert by_creditor[c].debtor_member_id == a
    assert by_creditor[c].amount == Decimal("3.00")


def test_settlements_use_exact_decimal_amounts(monkeypatch) -> None:
    a, b = uuid.uuid4(), uuid.uuid4()
    settlements = _compute(monkeypatch, [_balance(a, b, "12.37")])

    assert settlements[0].amount == Decimal("12.37")


def test_no_balances_means_no_settlements(monkeypatch) -> None:
    assert _compute(monkeypatch, []) == []
