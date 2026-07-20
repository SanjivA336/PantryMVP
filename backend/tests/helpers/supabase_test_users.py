"""Test-only helpers for provisioning real Supabase Auth users.

Used exclusively by the `rls`-marked test suite, which asserts real RLS
behavior against the linked hosted project rather than mocks. Keep total
test-user creation to a small, reused pool — the hosted project's Auth rate
limits (see supabase/config.toml) apply here just like production traffic.
"""

import httpx

from app.core.config import get_settings


async def create_test_user(email: str, password: str) -> dict:
    settings = get_settings()
    async with httpx.AsyncClient(base_url=settings.supabase_url) as client:
        response = await client.post(
            "/auth/v1/admin/users",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
            json={"email": email, "password": password, "email_confirm": True},
        )
        response.raise_for_status()
        return response.json()


async def sign_in(email: str, password: str) -> str:
    settings = get_settings()
    async with httpx.AsyncClient(base_url=settings.supabase_url) as client:
        response = await client.post(
            "/auth/v1/token",
            params={"grant_type": "password"},
            headers={"apikey": settings.supabase_anon_key},
            json={"email": email, "password": password},
        )
        response.raise_for_status()
        return response.json()["access_token"]


async def delete_test_user(user_id: str) -> None:
    settings = get_settings()
    async with httpx.AsyncClient(base_url=settings.supabase_url) as client:
        response = await client.delete(
            f"/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
            },
        )
        # Idempotent teardown: a user already gone (404) is not a test failure.
        if response.status_code not in (200, 404):
            response.raise_for_status()
