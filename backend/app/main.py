from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.requests import Request

from app.api.router import api_router
from app.core.config import get_settings
from app.core.responses import error_envelope

settings = get_settings()

app = FastAPI(title="Burrow API")

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
    # HTTPException handler above — without this, those responses would use
    # FastAPI's default {"detail": [...]} shape instead of our envelope.
    first_error = exc.errors()[0] if exc.errors() else {}
    message = first_error.get("msg", "Invalid request")
    return JSONResponse(
        status_code=422,
        content=error_envelope("422", message).model_dump(mode="json"),
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(_request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=error_envelope("500", "Internal server error").model_dump(mode="json"),
    )


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "environment": settings.environment}
