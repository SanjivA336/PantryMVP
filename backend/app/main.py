import sys

import sentry_sdk
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.api.router import api_router
from app.core.config import get_settings
from app.core.rate_limit import RateLimitMiddleware
from app.core.responses import error_envelope

settings = get_settings()

# A no-op until Settings.sentry_dsn is actually set (sentry_sdk's own
# functions -- capture_exception below included -- silently do nothing pre-
# init) -- no account needed for local dev. Errors only, not performance
# tracing, since that's what was actually asked for; it's a distinct Sentry
# feature with its own quota, not something to turn on as a side effect of
# wiring up error tracking.
if settings.sentry_dsn:
    sentry_sdk.init(dsn=settings.sentry_dsn, environment=settings.environment)

app = FastAPI(title="Burrow API")

# Per-client-IP backstop against abuse/scripted hammering -- see
# Settings.rate_limit_max_requests/_window_seconds. Auth (signup/login/
# password reset) never reaches this app at all (the frontend talks to
# Supabase Auth directly, which rate-limits that on its own), so this only
# ever covers the `/api/households/...` surface. Disabled under pytest: the
# whole suite shares one imported `app` (and so one middleware instance's
# in-memory counters) for its entire run, and a fast, high-volume test file
# hitting the real ASGI app (the rls/integration suites do) would otherwise
# trip it -- a false failure from the test harness, not a real client ever
# getting rate limited. Checking "pytest" in sys.modules rather than the
# PYTEST_CURRENT_TEST env var: that var is only set for the duration of
# each individual test, but this module gets imported once at collection
# time (before any test has started, via conftest.py's own `from app.main
# import app`) -- checking it here would just always see "not set" and
# permanently bake in enabled=True regardless of pytest. The pytest package
# itself, by contrast, is already imported by the time collection reaches
# this line, and stays imported for the rest of the process.
app.add_middleware(
    RateLimitMiddleware,
    max_requests=settings.rate_limit_max_requests,
    window_seconds=settings.rate_limit_window_seconds,
    enabled="pytest" not in sys.modules,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)


@app.exception_handler(HTTPException)
async def http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_envelope(str(exc.status_code), str(exc.detail)).model_dump(mode="json"),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
    # FastAPI's own request validation (missing/malformed body, headers, path
    # params) raises this before any route handler runs, bypassing the
    # HTTPException handler above -- without this, those responses would use
    # FastAPI's default {"detail": [...]} shape instead of our envelope.
    first_error = exc.errors()[0] if exc.errors() else {}
    detail = first_error.get("msg", "That didn't look right")
    # `loc` is a (location, ..., field_name) tuple, e.g. ("body", "quantity")
    # or ("path", "household_id") -- the field name alone, prefixed onto
    # pydantic's own message, turns an unattributed "Input should be greater
    # than 0" into "quantity: Input should be greater than 0", which is at
    # least attributable to a field even where the raw message stays technical.
    loc = first_error.get("loc", ())
    field = next(
        (str(part) for part in reversed(loc) if part not in ("body", "query", "path")), None
    )
    message = f"{field}: {detail}" if field else detail
    return JSONResponse(
        status_code=422,
        content=error_envelope("422", message).model_dump(mode="json"),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    # Explicit capture rather than relying on Sentry's own ASGI
    # instrumentation: this handler itself returns a normal response for
    # every unhandled exception (that's its whole job), so nothing ever
    # propagates as far as the server-error-level middleware Sentry's
    # auto-instrumentation typically hooks into. A no-op call if sentry_sdk
    # was never initialized (no DSN set).
    sentry_sdk.capture_exception(exc)
    return JSONResponse(
        status_code=500,
        content=error_envelope("500", "Internal server error").model_dump(mode="json"),
    )


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
