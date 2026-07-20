import time
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from jose import jwt

from app.main import app
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
