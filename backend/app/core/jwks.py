from functools import lru_cache

import httpx

from app.core.config import get_settings


class JWKSClient:
    """Fetches and caches this Supabase project's public JWT signing keys.

    This project uses Supabase's asymmetric JWT signing keys (ES256), not
    the legacy HS256 shared secret — verifying a token means matching its
    `kid` header against one of these published public keys, never trusting
    a secret embedded in application config.
    """

    def __init__(self, jwks_url: str) -> None:
        self._jwks_url = jwks_url
        self._keys_by_kid: dict[str, dict] = {}

    def _fetch(self) -> None:
        response = httpx.get(self._jwks_url, timeout=5.0)
        response.raise_for_status()
        self._keys_by_kid = {key["kid"]: key for key in response.json()["keys"]}

    def get_key(self, kid: str) -> dict | None:
        if kid not in self._keys_by_kid:
            # Refetch once on a cache miss — handles key rotation without
            # requiring a service restart, without refetching on every call.
            self._fetch()
        return self._keys_by_kid.get(kid)


@lru_cache
def get_jwks_client() -> JWKSClient:
    settings = get_settings()
    return JWKSClient(f"{settings.supabase_url}/auth/v1/.well-known/jwks.json")
