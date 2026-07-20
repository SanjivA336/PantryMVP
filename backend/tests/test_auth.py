import time
import uuid

import pytest
from fastapi import HTTPException
from jose import jwt

from app.core.auth import get_current_user_id
from tests.helpers.jwt_keys import TEST_SIGNING_KEY, ECSigningKey


def _make_token(
    sub: str | None = None,
    audience: str = "authenticated",
    expired: bool = False,
    signing_key: ECSigningKey = TEST_SIGNING_KEY,
    include_kid: bool = True,
    kid_override: str | None = None,
) -> str:
    now = int(time.time())
    payload: dict = {"aud": audience, "iat": now, "exp": now - 3600 if expired else now + 3600}
    if sub is not None:
        payload["sub"] = sub

    headers = {}
    if include_kid:
        headers["kid"] = kid_override or signing_key.kid

    return jwt.encode(payload, signing_key.private_pem, algorithm="ES256", headers=headers)


def test_valid_token_returns_user_id(mock_jwks) -> None:
    user_id = uuid.uuid4()
    token = _make_token(sub=str(user_id))

    result = get_current_user_id(authorization=f"Bearer {token}")

    assert result == user_id


def test_missing_bearer_prefix_raises_401(mock_jwks) -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization="not-a-bearer-token")

    assert exc_info.value.status_code == 401


def test_expired_token_raises_401(mock_jwks) -> None:
    token = _make_token(sub=str(uuid.uuid4()), expired=True)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_wrong_audience_raises_401(mock_jwks) -> None:
    token = _make_token(sub=str(uuid.uuid4()), audience="some-other-audience")

    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_missing_sub_claim_raises_401(mock_jwks) -> None:
    token = _make_token(sub=None)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_garbage_token_raises_401(mock_jwks) -> None:
    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization="Bearer not.a.valid.jwt")

    assert exc_info.value.status_code == 401


def test_missing_kid_header_raises_401(mock_jwks) -> None:
    token = _make_token(sub=str(uuid.uuid4()), include_kid=False)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_unknown_kid_raises_401(mock_jwks) -> None:
    token = _make_token(sub=str(uuid.uuid4()), kid_override="some-unknown-kid")

    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401


def test_token_signed_by_a_different_key_raises_401(mock_jwks) -> None:
    # Same kid the mocked JWKS client actually serves, but signed with a
    # different private key — this must fail signature verification, not
    # succeed just because the kid happened to match.
    impostor_key = ECSigningKey(kid=TEST_SIGNING_KEY.kid)
    token = _make_token(sub=str(uuid.uuid4()), signing_key=impostor_key)

    with pytest.raises(HTTPException) as exc_info:
        get_current_user_id(authorization=f"Bearer {token}")

    assert exc_info.value.status_code == 401
