import time
import uuid
from datetime import UTC, datetime

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.main import app
from app.schemas.member import Member
from tests.helpers.jwt_keys import TEST_SIGNING_KEY, FakeJWKSClient


def make_token(user_id: uuid.UUID) -> str:
    now = int(time.time())
    payload = {"aud": "authenticated", "iat": now, "exp": now + 3600, "sub": str(user_id)}
    return jwt.encode(
        payload,
        TEST_SIGNING_KEY.private_pem,
        algorithm="ES256",
        headers={"kid": TEST_SIGNING_KEY.kid},
    )


def auth_header(user_id: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(user_id)}"}


@pytest.fixture
def mock_jwks(monkeypatch):
    """Swap the real JWKS fetch for our local test keypair.

    Deliberately NOT autouse: the rls-marked suite needs the real network
    JWKS fetch against the real project, since it's testing the genuine
    end-to-end auth path — only the `client` fixture below opts into this.
    """
    fake_client = FakeJWKSClient({TEST_SIGNING_KEY.kid: TEST_SIGNING_KEY.jwk})
    monkeypatch.setattr("app.core.jwks.get_jwks_client", lambda: fake_client)


@pytest.fixture
async def client(mock_jwks):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


def make_member(
    household_id: uuid.UUID, user_id: uuid.UUID, *, is_admin: bool = False, is_active: bool = True
) -> Member:
    now = datetime.now(UTC)
    return Member(
        id=uuid.uuid4(),
        household_id=household_id,
        user_id=user_id,
        nickname="Test Member",
        is_admin=is_admin,
        is_active=is_active,
        created_at=now,
        updated_at=now,
    )


class MemberStore(dict):
    def seed(self, member: Member) -> Member:
        self[(member.household_id, member.id)] = member
        return member


@pytest.fixture
def fake_members(monkeypatch):
    """In-memory fake for app.services.members, so require_household_membership
    / require_household_admin work against seeded data without hitting Supabase.
    Reused by any test file exercising a household-scoped endpoint.
    """
    store: MemberStore = MemberStore()

    def get_active_member(household_id, user_id):
        return next(
            (
                m
                for m in store.values()
                if m.household_id == household_id and m.user_id == user_id and m.is_active
            ),
            None,
        )

    def get_member_by_id(household_id, member_id):
        return store.get((household_id, member_id))

    def list_members(household_id):
        return [m for m in store.values() if m.household_id == household_id]

    def count_active_admins(household_id):
        return sum(
            1
            for m in store.values()
            if m.household_id == household_id and m.is_admin and m.is_active
        )

    def update_member(household_id, member_id, updates):
        current = store[(household_id, member_id)]
        updated = current.model_copy(update=updates)
        store[(household_id, member_id)] = updated
        return updated

    def deactivate_member(household_id, member_id):
        return update_member(household_id, member_id, {"is_active": False})

    monkeypatch.setattr("app.services.members.get_active_member", get_active_member)
    monkeypatch.setattr("app.services.members.get_member_by_id", get_member_by_id)
    monkeypatch.setattr("app.services.members.list_members", list_members)
    monkeypatch.setattr("app.services.members.count_active_admins", count_active_admins)
    monkeypatch.setattr("app.services.members.update_member", update_member)
    monkeypatch.setattr("app.services.members.deactivate_member", deactivate_member)

    return store
