"""Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 s) for authenticator-app two-factor sign-in.

Implemented with the standard library only (it is ~20 lines of well-specified maths), and verified against the RFC 6238
test vectors in the test-suite. Secrets are random 160-bit values shown to the user in base32.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP = 30
DIGITS = 6
WINDOW = 1  # accept one step either side to tolerate clock drift


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _key(secret: str) -> bytes:
    return base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))


def code_at(secret: str, step: int, digits: int = DIGITS) -> str:
    digest = hmac.new(_key(secret), struct.pack(">Q", step), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** digits)
    return str(value).zfill(digits)


def current_step(now: float | None = None) -> int:
    return int((time.time() if now is None else now) // STEP)


def verify(secret: str, code: str, now: float | None = None, last_step: int = 0) -> int | None:
    """The matching time step when `code` is valid, else None. A step at or before `last_step` is rejected, so a code that
    was already used (or sniffed over a shoulder) cannot be replayed."""
    code = (code or "").strip().replace(" ", "")
    if not (code.isdigit() and len(code) == DIGITS):
        return None
    step = current_step(now)
    matched = None
    for s in range(step - WINDOW, step + WINDOW + 1):  # check every candidate: no early exit, so timing leaks nothing
        if hmac.compare_digest(code_at(secret, s), code) and matched is None:
            matched = s
    return matched if matched is not None and matched > last_step else None


def otpauth_uri(secret: str, account: str, issuer: str = "ReadVibe") -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(account)}?secret={secret}&issuer={quote(issuer)}&algorithm=SHA1&digits={DIGITS}&period={STEP}"


def new_backup_codes(n: int = 8) -> list[str]:
    """One-time recovery codes like 'k3f9-a82d' (shown once; only hashes are stored)."""
    alphabet = "abcdefghjkmnpqrstuvwxyz23456789"
    return ["".join(secrets.choice(alphabet) for _ in range(4)) + "-" + "".join(secrets.choice(alphabet) for _ in range(4)) for _ in range(n)]


def hash_backup_code(code: str) -> str:
    return hashlib.sha256(code.strip().lower().replace(" ", "").encode()).hexdigest()
