"""A local EC keypair standing in for Supabase's real (private, inaccessible)
JWT signing key, so mocked tests can mint tokens and verify them through the
exact same JWKS-lookup code path as production, without any network call.
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

TEST_KID = "test-key-1"


def _b64url_uint(number: int, length: int = 32) -> str:
    raw = number.to_bytes(length, byteorder="big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


class ECSigningKey:
    def __init__(self, kid: str = TEST_KID) -> None:
        self._private_key = ec.generate_private_key(ec.SECP256R1())
        public_numbers = self._private_key.public_key().public_numbers()
        self.kid = kid
        self.jwk: dict = {
            "kty": "EC",
            "crv": "P-256",
            "kid": kid,
            "alg": "ES256",
            "use": "sig",
            "x": _b64url_uint(public_numbers.x),
            "y": _b64url_uint(public_numbers.y),
        }

    @property
    def private_pem(self) -> str:
        return self._private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()


TEST_SIGNING_KEY = ECSigningKey()


class FakeJWKSClient:
    def __init__(self, keys_by_kid: dict[str, dict]) -> None:
        self._keys_by_kid = keys_by_kid

    def get_key(self, kid: str) -> dict | None:
        return self._keys_by_kid.get(kid)
