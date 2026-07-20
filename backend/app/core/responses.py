from datetime import UTC, datetime

from pydantic import BaseModel


class ErrorDetail(BaseModel):
    code: str
    message: str


class Envelope[T](BaseModel):
    status: str  # "success" | "error"
    data: T | None = None
    error: ErrorDetail | None = None
    timestamp: datetime


def ok[T](data: T) -> Envelope[T]:
    return Envelope(status="success", data=data, timestamp=datetime.now(UTC))


def error_envelope(code: str, message: str) -> Envelope[None]:
    return Envelope(
        status="error", error=ErrorDetail(code=code, message=message), timestamp=datetime.now(UTC)
    )
