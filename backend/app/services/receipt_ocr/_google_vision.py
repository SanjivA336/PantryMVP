import base64

import httpx

from app.core.config import get_settings

_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate"


def run(image_bytes: bytes):
    # Local import: __init__.py imports this module, so importing back from
    # it at module level would be circular.
    from app.services.receipt_ocr import OcrEngineNotConfiguredError, OcrResult

    settings = get_settings()
    if not settings.google_vision_api_key:
        raise OcrEngineNotConfiguredError(
            "GOOGLE_VISION_API_KEY is not set -- add it to .env to enable receipt scanning."
        )

    # DOCUMENT_TEXT_DETECTION (rather than plain TEXT_DETECTION) is Google's
    # recommended feature for dense-text documents like receipts.
    body = {
        "requests": [
            {
                "image": {"content": base64.b64encode(image_bytes).decode("ascii")},
                "features": [{"type": "DOCUMENT_TEXT_DETECTION"}],
            }
        ]
    }
    response = httpx.post(
        _ENDPOINT,
        params={"key": settings.google_vision_api_key},
        json=body,
        timeout=30.0,
    )
    response.raise_for_status()
    data = response.json()

    result = data["responses"][0]
    if "error" in result:
        raise RuntimeError(f"Google Vision error: {result['error'].get('message')}")

    text = result.get("fullTextAnnotation", {}).get("text", "")
    return OcrResult(raw_text=text)
