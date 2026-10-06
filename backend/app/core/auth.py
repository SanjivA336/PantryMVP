from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt

from app.core import jwks as jwks_module
from app.core.concurrency import run_parallel
from app.core.config import get_settings
from app.schemas.member import Member
from app.services import members as members_service
from app.services import users as users_service


def _session_expired() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, "Your session isn't valid. Please log in again."
    )


def _verify_token(authorization: str) -> UUID:
    """Verify the Supabase-issued bearer JWT and return the caller's user id.
    No database call: the signature, expiry and audience are all checked
    locally against this project's published keys.

    Verification is JWKS-based (ES256): the token's `kid` header is matched
    against this project's published public signing keys, fetched from
    `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. This project does not use
    the legacy HS256 shared-secret scheme, even though a JWT secret is still
    present in project settings for backward compatibility with older APIs.

    This does NOT confirm the account still exists -- see get_current_user_id
    and require_household_membership, which both do, for the reason it matters.
    """
    # Every failure below ends in the same user-facing text -- whatever
    # actually went wrong with the token (missing, malformed, expired,
    # signed by an unknown key, ...) means the same thing to whoever's
    # looking at the screen: log in again. The specific reason is still the
    # real HTTPException detail underneath for anyone reading server logs,
    # just not something to show a user mid-JWT-internals.
    session_expired = _session_expired()

    if not authorization.startswith("Bearer "):
        raise session_expired

    token = authorization.removeprefix("Bearer ")

    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise session_expired from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise session_expired

    jwk = jwks_module.get_jwks_client().get_key(kid)
    if jwk is None:
        raise session_expired

    try:
        payload = jwt.decode(
            token,
            jwk,
            algorithms=[jwk.get("alg", "ES256")],
            audience="authenticated",
        )
    except JWTError as exc:
        raise session_expired from exc

    sub = payload.get("sub")
    if not sub:
        raise session_expired

    return UUID(sub)


def get_current_user_id(authorization: str = Header(...)) -> UUID:
    """Verify the bearer JWT (see _verify_token) and return the caller's user id.

    Also confirms the account still exists: a JWT is self-contained and
    cryptographically valid regardless of whether the account it names has
    since been deleted, so without this check a token issued minutes before
    an account deletion would keep working against this API for up to an
    hour (its natural expiry) -- see users.user_exists.
    """
    user_id = _verify_token(authorization)
    if not users_service.user_exists(user_id):
        raise _session_expired()
    return user_id


def require_household_membership(household_id: UUID, authorization: str = Header(...)) -> Member:
    """FastAPI dependency: caller must be an active member of `household_id`.

    Does the same account-still-exists check as get_current_user_id, but runs
    it together with the membership lookup instead of before it: the two don't
    depend on each other, and each is a network round trip to the database, so
    doing them one after the other made every household request pay for both
    in sequence. Same answers as before -- 401 for a deleted account, 403 for
    a non-member -- just one round trip's worth of waiting instead of two.

    `household_id` is resolved from the route's path parameter of the same
    name, so any handler on a `/{household_id}` route gets this for free.

    This is the FastAPI-side authorization layer. It must never assume RLS
    already caught an unauthorized request, since FastAPI's writes use the
    service-role key, which bypasses RLS entirely, so this check is the only
    thing standing between a request and someone else's household data.
    """
    user_id = _verify_token(authorization)
    account_exists, member = run_parallel(
        lambda: users_service.user_exists(user_id),
        lambda: members_service.get_active_member(household_id, user_id),
    )
    if not account_exists:
        raise _session_expired()
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You don't have access to this household")
    return member


def require_household_admin(member: Member = Depends(require_household_membership)) -> Member:
    if not member.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You need to be an admin to do that")
    return member


def is_developer(user_id: UUID) -> bool:
    """True for accounts in DEVELOPER_USER_IDS -- the fixed allowlist gating
    AI/OCR-backed features. Reads settings fresh on every call (not cached
    into a module-level set at import time) so it stays test-monkeypatchable
    via get_settings and so a changed .env value takes effect on restart
    without needing a code change.
    """
    raw = get_settings().developer_user_ids
    developer_ids = {UUID(part.strip()) for part in raw.split(",") if part.strip()}
    return user_id in developer_ids


def require_developer(user_id: UUID = Depends(get_current_user_id)) -> UUID:
    if not is_developer(user_id):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "This feature isn't available on your account"
        )
    return user_id
