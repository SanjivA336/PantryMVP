from decimal import Decimal

from app.schemas.receipt_import import ParsedReceiptItem
from app.schemas.units import Unit
from app.services import receipt_imports as receipt_imports_service
from app.services.ai.base import AiProviderTimeoutError, AiProviderUnavailableError


def test_ai_items_to_parsed_lines_converts_valid_items() -> None:
    items = [ParsedReceiptItem(name="Whole Milk", price="4.99", quantity="1", unit="gal")]

    lines = receipt_imports_service._ai_items_to_parsed_lines(items)

    assert len(lines) == 1
    line = lines[0]
    assert line.raw_line_text == "Whole Milk"
    assert line.parsed_name == "Whole Milk"
    assert line.parsed_price == Decimal("4.99")
    assert line.parsed_quantity == Decimal("1")
    # parsed_unit keeps the AI's raw guess verbatim; preferred_unit is the
    # same guess coerced against the closed Unit vocabulary -- "gal" matches
    # a real unit now (it didn't before this app tracked gallons).
    assert line.parsed_unit == "gal"
    assert line.preferred_unit == Unit.GAL


def test_ai_items_to_parsed_lines_strips_currency_symbol_and_commas() -> None:
    # A weak local model doesn't always follow the "no $" instruction --
    # confirmed against the real model returning "$4.66" for a plain 4.66.
    items = [ParsedReceiptItem(name="Zucchini", price="$1,234.66", quantity="$0.778")]

    lines = receipt_imports_service._ai_items_to_parsed_lines(items)

    assert len(lines) == 1
    assert lines[0].parsed_price == Decimal("1234.66")
    assert lines[0].parsed_quantity == Decimal("0.778")


def test_parse_receipt_lines_falls_back_to_regex_when_nothing_survives_coercion(
    monkeypatch,
) -> None:
    class GarbledProvider:
        def parse_receipt_items(self, raw_text: str) -> list[ParsedReceiptItem]:
            return [ParsedReceiptItem(name="Whole Milk", price="not-a-number-even-after-stripping")]

    monkeypatch.setattr("app.services.receipt_imports.get_ai_provider", lambda: GarbledProvider())

    lines = receipt_imports_service._parse_receipt_lines("WHOLE MILK 4.99\nSUBTOTAL 4.99")

    assert len(lines) == 1
    assert lines[0].parsed_name == "WHOLE MILK"


def test_ai_items_to_parsed_lines_drops_items_with_unparseable_price() -> None:
    items = [
        ParsedReceiptItem(name="Whole Milk", price="4.99"),
        ParsedReceiptItem(name="Garbled Line", price="not-a-number"),
    ]

    lines = receipt_imports_service._ai_items_to_parsed_lines(items)

    assert len(lines) == 1
    assert lines[0].parsed_name == "Whole Milk"


def test_ai_items_to_parsed_lines_ignores_unparseable_quantity_without_dropping_item() -> None:
    items = [ParsedReceiptItem(name="Bananas", price="1.20", quantity="a bunch")]

    lines = receipt_imports_service._ai_items_to_parsed_lines(items)

    assert len(lines) == 1
    assert lines[0].parsed_quantity is None
    assert lines[0].parsed_price == Decimal("1.20")


def test_parse_receipt_lines_uses_ai_result_when_available(monkeypatch) -> None:
    class FakeProvider:
        def parse_receipt_items(self, raw_text: str) -> list[ParsedReceiptItem]:
            return [ParsedReceiptItem(name="Whole Milk", price="4.99")]

    monkeypatch.setattr("app.services.receipt_imports.get_ai_provider", lambda: FakeProvider())

    lines = receipt_imports_service._parse_receipt_lines("WHOLE MILK 4.99")

    assert len(lines) == 1
    assert lines[0].parsed_name == "Whole Milk"


def test_parse_receipt_lines_falls_back_to_regex_on_ai_unavailable(monkeypatch) -> None:
    def _unavailable():
        raise AiProviderUnavailableError("no ollama here")

    monkeypatch.setattr("app.services.receipt_imports.get_ai_provider", _unavailable)

    lines = receipt_imports_service._parse_receipt_lines("WHOLE MILK 4.99\nSUBTOTAL 4.99")

    assert len(lines) == 1
    assert lines[0].parsed_name == "WHOLE MILK"


def test_parse_receipt_lines_falls_back_to_regex_on_ai_timeout(monkeypatch) -> None:
    class SlowProvider:
        def parse_receipt_items(self, raw_text: str) -> list[ParsedReceiptItem]:
            raise AiProviderTimeoutError("took too long")

    monkeypatch.setattr("app.services.receipt_imports.get_ai_provider", lambda: SlowProvider())

    lines = receipt_imports_service._parse_receipt_lines("WHOLE MILK 4.99\nSUBTOTAL 4.99")

    assert len(lines) == 1
    assert lines[0].parsed_name == "WHOLE MILK"
