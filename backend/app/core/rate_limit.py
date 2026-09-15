"""A small per-client-IP rate limiter, hand-rolled instead of pulled from a
library: slowapi (the usual choice here) silently no-ops against this
project's FastAPI/Starlette version -- it introspects `app.routes` to find
which endpoint a request matches, and that version's routing internals
(lazily-resolved `_IncludedRouter`/`_EffectiveRouteContext` wrappers, not
the flat list of plain `APIRoute` objects slowapi expects) make every
lookup come back empty, which slowapi treats as "no handler found, exempt."
It reports itself as enabled and correctly configured the whole time --
the requests just never actually got counted. This avoids all of that by
never touching FastAPI's route representation at all.

Fixed window, in memory, per process. Good enough for a single backend
instance (this app's current and near-term deployment target); would need
a shared store (Redis, etc.) the moment there's more than one instance.
"""

import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.responses import error_envelope

# Paths that skip the limit entirely -- health checks are meant to be
# polled frequently by uptime monitors, not real client traffic.
_EXEMPT_PATHS = {"/health"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(
        self, app, *, max_requests: int, window_seconds: float, enabled: bool = True
    ) -> None:
        super().__init__(app)
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._enabled = enabled
        # {client_key: (window_start_epoch, count_in_window)}
        self._counters: dict[str, tuple[float, int]] = defaultdict(lambda: (0.0, 0))

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not self._enabled or request.url.path in _EXEMPT_PATHS:
            return await call_next(request)

        client_key = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window_start, count = self._counters[client_key]

        if now - window_start >= self._window_seconds:
            # Window's expired -- start a fresh one at this request.
            window_start, count = now, 0

        count += 1
        self._counters[client_key] = (window_start, count)

        if count > self._max_requests:
            retry_after = max(0, int(self._window_seconds - (now - window_start)))
            return JSONResponse(
                status_code=429,
                content=error_envelope(
                    "429", "Too many requests -- slow down and try again"
                ).model_dump(mode="json"),
                headers={"Retry-After": str(retry_after)},
            )

        return await call_next(request)
