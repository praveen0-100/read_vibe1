"""Encryption at rest for small secrets (the TOTP seed). Fernet (AES-128-CBC + HMAC) with a key derived from the app secret.

Rotating READVIBE_JWT_SECRET makes stored seeds undecryptable, which is the safe failure: affected users re-enrol 2FA.
"""
from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from ..config import get_settings


def _fernet() -> Fernet:
    key = hashlib.sha256(("readvibe-secretbox|" + get_settings().jwt_secret).encode()).digest()
    return Fernet(base64.urlsafe_b64encode(key))


def seal(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def unseal(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        return None
