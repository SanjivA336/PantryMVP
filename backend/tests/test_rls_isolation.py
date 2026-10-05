"""RLS isolation tests, run against the real linked Supabase project.

Excluded from the default `pytest` run (see pyproject.toml's addopts) since
it costs real Supabase Auth quota; run explicitly with `uv run pytest -m rls`.

This suite tests the RLS policies directly via PostgREST with each user's own
JWT, which is a *separate* boundary from FastAPI's own membership checks
(covered by the mocked tests in test_members_authorization.py). FastAPI's
writes use the service-role key and bypass RLS entirely, so this file is the
only place RLS itself is actually exercised.
"""

import uuid

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.rls

_PASSWORD = "Burrow-Test-Password-123!"


@pytest.fixture(scope="module")
async def two_users():
    suffix = uuid.uuid4().hex[:8]
    user_a = await create_test_user(f"burrow-rls-test-a-{suffix}@example.com", _PASSWORD)
    user_b = await create_test_user(f"burrow-rls-test-b-{suffix}@example.com", _PASSWORD)
    token_a = await sign_in(user_a["email"], _PASSWORD)
    token_b = await sign_in(user_b["email"], _PASSWORD)

    yield {
        "a": {"id": user_a["id"], "token": token_a},
        "b": {"id": user_b["id"], "token": token_b},
    }

    await delete_test_user(user_a["id"])
    await delete_test_user(user_b["id"])


@pytest.fixture
async def api_client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def _create_household(api_client: AsyncClient, token: str, name: str) -> dict:
    response = await api_client.post(
        "/api/households",
        json={"name": name, "nickname": "Tester"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]


async def _delete_household(api_client: AsyncClient, token: str, household_id: str) -> None:
    await api_client.delete(
        f"/api/households/{household_id}", headers={"Authorization": f"Bearer {token}"}
    )


async def test_non_member_gets_empty_result_on_direct_rest_select(api_client, two_users) -> None:
    settings = get_settings()
    household = await _create_household(api_client, two_users["a"]["token"], "RLS Test Household A")

    try:
        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest_client:
            households_response = await rest_client.get(
                "/rest/v1/households",
                params={"id": f"eq.{household['id']}"},
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['b']['token']}",
                },
            )
            members_response = await rest_client.get(
                "/rest/v1/members",
                params={"household_id": f"eq.{household['id']}"},
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['b']['token']}",
                },
            )

        # RLS silently filters SELECT rows rather than raising, so an
        # outsider sees an empty array, not a 403/404.
        assert households_response.status_code == 200
        assert households_response.json() == []
        assert members_response.status_code == 200
        assert members_response.json() == []
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household["id"])


async def test_non_member_cannot_insert_a_membership_row(api_client, two_users) -> None:
    settings = get_settings()
    household = await _create_household(api_client, two_users["a"]["token"], "RLS Test Household B")

    try:
        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest_client:
            response = await rest_client.post(
                "/rest/v1/members",
                json={
                    "household_id": household["id"],
                    "user_id": two_users["b"]["id"],
                    "nickname": "Self-invited intruder",
                },
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['b']['token']}",
                },
            )

        assert response.status_code in (401, 403)
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household["id"])


async def test_fastapi_returns_403_for_non_member(api_client, two_users) -> None:
    household = await _create_household(api_client, two_users["a"]["token"], "RLS Test Household C")

    try:
        response = await api_client.get(
            f"/api/households/{household['id']}",
            headers={"Authorization": f"Bearer {two_users['b']['token']}"},
        )

        assert response.status_code == 403
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household["id"])


async def test_joining_by_code_grants_rest_visibility(api_client, two_users) -> None:
    settings = get_settings()
    household = await _create_household(api_client, two_users["a"]["token"], "RLS Test Household D")

    try:
        join_response = await api_client.post(
            "/api/households/join",
            json={"join_code": household["join_code"], "nickname": "Joiner"},
            headers={"Authorization": f"Bearer {two_users['b']['token']}"},
        )
        assert join_response.status_code == 200, join_response.text

        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest_client:
            response = await rest_client.get(
                "/rest/v1/households",
                params={"id": f"eq.{household['id']}"},
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['b']['token']}",
                },
            )

        assert response.status_code == 200
        assert len(response.json()) == 1
        assert response.json()[0]["id"] == household["id"]
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household["id"])


def _rest_headers(token: str, prefer_representation: bool = False) -> dict:
    headers = {"apikey": get_settings().supabase_anon_key, "Authorization": f"Bearer {token}"}
    if prefer_representation:
        headers["Prefer"] = "return=representation"
    return headers


async def test_member_cannot_promote_themselves_via_direct_rest(api_client, two_users) -> None:
    # Regression for the 2026-10-05 review: RLS alone let a member PATCH their own
    # members row (including is_admin). Migration 0041 removes client write
    # privileges on every public table, so PostgREST must refuse the write.
    settings = get_settings()
    household = await _create_household(api_client, two_users["a"]["token"], "RLS Test Household E")

    try:
        join_response = await api_client.post(
            "/api/households/join",
            json={"join_code": household["join_code"], "nickname": "Joiner"},
            headers={"Authorization": f"Bearer {two_users['b']['token']}"},
        )
        assert join_response.status_code == 200, join_response.text

        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest_client:
            patch_response = await rest_client.patch(
                "/rest/v1/members",
                params={
                    "household_id": f"eq.{household['id']}",
                    "user_id": f"eq.{two_users['b']['id']}",
                },
                json={"is_admin": True},
                headers=_rest_headers(two_users["b"]["token"], prefer_representation=True),
            )
            row_response = await rest_client.get(
                "/rest/v1/members",
                params={
                    "household_id": f"eq.{household['id']}",
                    "user_id": f"eq.{two_users['b']['id']}",
                    "select": "is_admin",
                },
                headers=_rest_headers(two_users["b"]["token"]),
            )

        assert patch_response.status_code in (401, 403)
        assert row_response.status_code == 200
        assert row_response.json() == [{"is_admin": False}]
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household["id"])


async def test_admin_cannot_change_household_owner_via_direct_rest(api_client, two_users) -> None:
    settings = get_settings()
    household = await _create_household(api_client, two_users["a"]["token"], "RLS Test Household F")

    try:
        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest_client:
            patch_response = await rest_client.patch(
                "/rest/v1/households",
                params={"id": f"eq.{household['id']}"},
                json={"owner_id": two_users["b"]["id"]},
                headers=_rest_headers(two_users["a"]["token"], prefer_representation=True),
            )

        assert patch_response.status_code in (401, 403)
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household["id"])
