from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from jose import JWTError, jwt

from app.core import jwks as jwks_module
from app.schemas.member import Member
from app.services import members as members_service


def get_current_user_id(authorization: str = Header(...)) -> UUID:
    """Verify the Supabase-issued bearer JWT and return the caller's user id.

    Verification is JWKS-based (ES256): the token's `kid` header is matched
    against this project's published public signing keys, fetched from
    `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`. This project does not use
    the legacy HS256 shared-secret scheme, even though a JWT secret is still
    present in project settings for backward compatibility with older APIs.
    """
    if not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing bearer token")

    token = authorization.removeprefix("Bearer ")

    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Malformed token: {exc}") from exc

    kid = unverified_header.get("kid")
    if not kid:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing kid header")

    jwk = jwks_module.get_jwks_client().get_key(kid)
    if jwk is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Unknown signing key")

    try:
        payload = jwt.decode(
            token,
            jwk,
            algorithms=[jwk.get("alg", "ES256")],
            audience="authenticated",
        )
    except JWTError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Invalid token: {exc}") from exc

    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token missing sub claim")

    return UUID(sub)


def require_household_membership(
    household_id: UUID, user_id: UUID = Depends(get_current_user_id)
) -> Member:
    """FastAPI dependency: caller must be an active member of `household_id`.

    `household_id` is resolved from the route's path parameter of the same
    name — any handler on a `/{household_id}` route gets this for free.

    This is the FastAPI-side authorization layer. It must never assume RLS
    already caught an unauthorized request — FastAPI's writes use the
    service-role key, which bypasses RLS entirely, so this check is the only
    thing standing between a request and someone else's household data.
    """
    member = members_service.get_active_member(household_id, user_id)
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this household")
    return member


def require_household_admin(member: Member = Depends(require_household_membership)) -> Member:
    if not member.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin privileges required")
    return member
