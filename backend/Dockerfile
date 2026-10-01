# Backend container image (Cloud Run, Fly.io, Railway, Render-with-Docker, ...).
# Build from the backend/ folder:  docker build -t burrow-api backend

FROM python:3.13-slim

# uv, pinned, copied from its official image: much faster than pip and installs
# exactly the versions recorded in uv.lock.
COPY --from=ghcr.io/astral-sh/uv:0.11.29 /uv /usr/local/bin/uv

WORKDIR /app

# Dependencies first, app code second: Docker caches each step, so a code-only
# change rebuilds just the last layers instead of reinstalling everything.
# --frozen refuses to touch uv.lock; --no-dev leaves out pytest/ruff.
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# Don't run as root inside the container.
RUN useradd --create-home appuser
USER appuser

ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1

# The host injects PORT (Cloud Run uses 8080). The proxy flags matter for the
# rate limiter: it counts per client IP, and behind a platform's reverse proxy
# the connecting address is the proxy's, not the user's. Trusting
# X-Forwarded-For makes request.client.host the real client, so users get
# separate buckets instead of sharing the proxy's. Known limitation: with '*'
# uvicorn uses the LEFTMOST address in that header, and a client can send its
# own fake value that the platform proxy then appends to, so someone
# deliberately rotating fake addresses can dodge the per-IP cap. It's a
# backstop against casual hammering, not a security boundary (every route is
# still behind JWT auth + membership checks). '*' also means never expose this
# container directly to the internet; these hosts only reach it via their proxy.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --proxy-headers --forwarded-allow-ips='*'"]
