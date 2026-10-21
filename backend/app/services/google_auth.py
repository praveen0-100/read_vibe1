"""Google Sign-In: verify Google Identity Services ID tokens server-side."""
from __future__ import annotations

from functools import lru_cache

from ..config import get_settings

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


class GoogleAuthError(Exception):
    pass


def enabled() -> bool:
    return bool(get_settings().google_client_id)


@lru_cache
def _transport():
    # A shared session lets google-auth cache Google's signing certificates between requests.
    import requests
    from google.auth.transport import requests as google_requests

    return google_requests.Request(session=requests.Session())


def verify_credential(credential: str) -> dict:
    """Validate signature, audience, issuer and expiry; return the token claims.

    Never trust claims decoded on the client — the browser only forwards the signed JWT.
    """
    client_id = get_settings().google_client_id
    if not client_id:
        raise GoogleAuthError("Google sign-in is not configured on this server")
    from google.auth import exceptions as google_exceptions
    from google.oauth2 import id_token

    try:
        claims = id_token.verify_oauth2_token(credential, _transport(), client_id, clock_skew_in_seconds=10)
    except ValueError as exc:  # bad signature, wrong audience, expired, malformed
        raise GoogleAuthError("Google sign-in could not be verified. Please try again.") from exc
    except google_exceptions.GoogleAuthError as exc:  # e.g. Google's certificate endpoint unreachable
        raise GoogleAuthError("Couldn't reach Google to verify your sign-in. Check your connection and try again.") from exc
    if claims.get("iss") not in GOOGLE_ISSUERS:
        raise GoogleAuthError("Unexpected token issuer")
    if not claims.get("email") or not claims.get("email_verified"):
        raise GoogleAuthError("Your Google account email is not verified")
    return claims
