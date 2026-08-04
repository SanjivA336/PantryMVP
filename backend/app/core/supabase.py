import threading

from supabase import Client, create_client

from app.core.config import get_settings

_local = threading.local()


def get_service_client() -> Client:
    """Service-role Supabase client for FastAPI's own writes.

    This key bypasses RLS entirely, so every write path that uses this
    client must independently re-check membership/admin rights in code —
    see app.core.auth. Never expose this client or its key to the frontend.

    One client per thread, not a single process-wide instance: FastAPI runs
    sync path operations in a thread pool, and sharing one client's
    underlying connection pool across concurrent threads causes spurious
    socket errors (reproduced as WinError 10035 on Windows) once two
    requests land on it at the same time.
    """
    client: Client | None = getattr(_local, "client", None)
    if client is None:
        settings = get_settings()
        client = create_client(settings.supabase_url, settings.supabase_service_role_key)
        _local.client = client
    return client
