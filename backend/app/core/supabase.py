from functools import lru_cache

from supabase import Client, create_client

from app.core.config import get_settings


@lru_cache
def get_service_client() -> Client:
    """Service-role Supabase client for FastAPI's own writes.

    This key bypasses RLS entirely, so every write path that uses this
    client must independently re-check membership/admin rights in code —
    see app.core.auth. Never expose this client or its key to the frontend.
    """
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)
