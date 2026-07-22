import re
from dataclasses import dataclass
from decimal import Decimal

# Common receipt boilerplate that isn't a purchased item.
_NOISE_LINE_RE = re.compile(
    r"subtotal|total|tax|cash|change|debit|credit|visa|mastercard|"
    r"balance|tender|thank you|store #|cashier|register",
    re.IGNORECASE,
)
_BARCODE_LINE_RE = re.compile(r"^\d{8,}$")

# Trailing price, optionally prefixed with $ and suffixed with a single
# tax-code letter (a common receipt convention, e.g. "MILK 4.99 F").
_PRICE_RE = re.compile(r"^(.+?)\s+\$?(\d{1,4}\.\d{2})\s*[A-Z]?$")

# Only an explicit "N x ..." / "N @ ..." prefix counts as quantity -- a bare
# leading integer is too easily a SKU/product code to trust.
_QUANTITY_PREFIX_RE = re.compile(r"^(\d+(?:\.\d+)?)\s*[x@]\s*(.+)$", re.IGNORECASE)


@dataclass
class ParsedLine:
    raw_line_text: str
    parsed_name: str | None
    parsed_quantity: Decimal | None
    parsed_unit: str | None
    parsed_price: Decimal | None


def _is_noise(line: str) -> bool:
    return (
        bool(_NOISE_LINE_RE.search(line))
        or bool(_BARCODE_LINE_RE.match(line))
        or line.startswith("-")
    )


def parse_receipt_text(raw_text: str) -> list[ParsedLine]:
    """Best-effort split of raw OCR text into candidate line items.

    Deliberately simple -- real receipts wrap item names across lines,
    print weighted items as "1.24 lb @ 0.59/lb", and use currency formats
    this never tries to handle. None of that matters much in practice
    because every parsed line is a *candidate* a human confirms or edits
    before finalize ever touches inventory; this only needs to get most
    lines close enough to save typing, not perfectly right.
    """
    lines: list[ParsedLine] = []
    for raw_line in raw_text.splitlines():
        line = raw_line.strip()
        if not line or _is_noise(line):
            continue

        price_match = _PRICE_RE.match(line)
        if price_match:
            remainder, price_str = price_match.group(1).strip(), price_match.group(2)
            parsed_price = Decimal(price_str)
        else:
            remainder, parsed_price = line, None

        quantity_match = _QUANTITY_PREFIX_RE.match(remainder)
        if quantity_match:
            parsed_quantity = Decimal(quantity_match.group(1))
            remainder = quantity_match.group(2).strip()
        else:
            parsed_quantity = None

        lines.append(
            ParsedLine(
                raw_line_text=line,
                parsed_name=remainder or None,
                parsed_quantity=parsed_quantity,
                parsed_unit=None,
                parsed_price=parsed_price,
            )
        )

    return lines
