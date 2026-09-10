import base64
import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.database import AccessLog, User, get_db

SECRET_KEY = os.environ.get("TRANSITTRACK_SECRET", "transittrack-ai-local-secret")
TOKEN_TTL_SECONDS = 60 * 60 * 12
PBKDF2_ITERATIONS = 120_000
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return f"{salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split("$", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
        return hmac.compare_digest(expected, actual)
    except (ValueError, TypeError):
        return False


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def create_token(username: str) -> str:
    payload = {"sub": username, "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    body = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(SECRET_KEY.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def decode_token(token: str) -> str:
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(SECRET_KEY.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected, signature):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

        payload = json.loads(_b64url_decode(body).decode("utf-8"))
        if payload.get("exp", 0) < time.time():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please log in again.")
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")
        return username
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.") from exc


def log_access(db: Session, username: str, action: str, resource: str, success: bool = True):
    entry = AccessLog(
        username=username or "anonymous",
        action=action,
        resource=resource,
        success=success,
        timestamp=datetime.now(timezone.utc).replace(microsecond=0),
    )
    db.add(entry)
    db.commit()



def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        log_access(db, "anonymous", "auth_required", "protected", False)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required.")

    username = decode_token(credentials.credentials)
    user = db.query(User).filter(User.username == username).first()
    if user is None:
        log_access(db, username, "auth_required", "protected", False)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required.")
    return user
