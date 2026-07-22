"""RLS isolation tests for the receipt-images Storage bucket, against the
real linked Supabase project. Excluded from the default run; run
explicitly with `uv run pytest -m rls`.
"""

import uuid

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.core.config import get_settings
from app.main import app
from tests.helpers.supabase_test_users import create_test_user, delete_test_user, sign_in

pytestmark = pytest.mark.rls

_PASSWORD = "Burrow-Storage-Rls-Test-123!"


@pytest.fixture(scope="module")
async def two_users():
    suffix = uuid.uuid4().hex[:8]
    user_a = await create_test_user(f"burrow-storage-rls-a-{suffix}@example.com", _PASSWORD)
    user_b = await create_test_user(f"burrow-storage-rls-b-{suffix}@example.com", _PASSWORD)
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


async def _create_household(api_client: AsyncClient, token: str, name: str) -> str:
    response = await api_client.post(
        "/api/households",
        json={"name": name, "nickname": "Tester"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 201, response.text
    return response.json()["data"]["id"]


async def _delete_household(api_client: AsyncClient, token: str, household_id: str) -> None:
    await api_client.delete(
        f"/api/households/{household_id}", headers={"Authorization": f"Bearer {token}"}
    )


async def test_member_can_upload_and_read_back_own_household_object(api_client, two_users) -> None:
    settings = get_settings()
    household_id = await _create_household(api_client, two_users["a"]["token"], "Storage RLS A")

    try:
        path = f"{household_id}/{uuid.uuid4()}.jpg"
        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
            upload = await rest.post(
                f"/storage/v1/object/receipt-images/{path}",
                content=b"fake receipt bytes",
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['a']['token']}",
                    "Content-Type": "image/jpeg",
                },
            )
            assert upload.status_code in (200, 201), upload.text

            download = await rest.get(
                f"/storage/v1/object/receipt-images/{path}",
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['a']['token']}",
                },
            )
            assert download.status_code == 200
            assert download.content == b"fake receipt bytes"
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household_id)


async def test_non_member_cannot_upload_into_anothers_household_folder(
    api_client, two_users
) -> None:
    settings = get_settings()
    household_id = await _create_household(api_client, two_users["a"]["token"], "Storage RLS B")

    try:
        path = f"{household_id}/{uuid.uuid4()}.jpg"
        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
            upload = await rest.post(
                f"/storage/v1/object/receipt-images/{path}",
                content=b"intruder bytes",
                headers={
                    "apikey": settings.supabase_anon_key,
                    # User B is not a member of household A.
                    "Authorization": f"Bearer {two_users['b']['token']}",
                    "Content-Type": "image/jpeg",
                },
            )
            assert upload.status_code in (400, 401, 403)
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household_id)


async def test_non_member_cannot_read_anothers_household_object(api_client, two_users) -> None:
    settings = get_settings()
    household_id = await _create_household(api_client, two_users["a"]["token"], "Storage RLS C")

    try:
        path = f"{household_id}/{uuid.uuid4()}.jpg"
        async with httpx.AsyncClient(base_url=settings.supabase_url) as rest:
            upload = await rest.post(
                f"/storage/v1/object/receipt-images/{path}",
                content=b"household a's receipt",
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['a']['token']}",
                    "Content-Type": "image/jpeg",
                },
            )
            assert upload.status_code in (200, 201), upload.text

            download = await rest.get(
                f"/storage/v1/object/receipt-images/{path}",
                headers={
                    "apikey": settings.supabase_anon_key,
                    "Authorization": f"Bearer {two_users['b']['token']}",
                },
            )
            assert download.status_code in (400, 401, 403, 404)
    finally:
        await _delete_household(api_client, two_users["a"]["token"], household_id)
