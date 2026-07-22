from dataclasses import dataclass

from app.core.config import get_settings
from app.services.receipt_ocr import _google_vision


@dataclass
class OcrResult:
    """Exactly one of the two fields is populated. `raw_text` comes from a
    general-purpose OCR engine (needs `receipt_parsing.parse_receipt_text`
    to turn it into candidate line items). `line_items` would come from a
    receipt-specialized structured-extraction engine (e.g. Taggun/Veryfi,
    not implemented here) that skips our own parser entirely -- kept as a
    field now so adding that engine later doesn't require reshaping this
    result type."""

    raw_text: str | None = None
    line_items: list[dict] | None = None


class OcrEngineNotConfiguredError(Exception):
    pass


def run_ocr(image_bytes: bytes, mime_type: str) -> OcrResult:
    """Single entry point every caller uses -- callers never know or care
    which engine actually ran. Swapping engines (or adding a second one)
    is a change to this dispatch plus a new sibling module, not a change
    to any caller."""
    settings = get_settings()
    if settings.ocr_engine == "google_vision":
        return _google_vision.run(image_bytes)
    raise OcrEngineNotConfiguredError(f"Unknown OCR engine: {settings.ocr_engine!r}")
