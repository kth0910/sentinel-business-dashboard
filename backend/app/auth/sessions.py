import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import AuthSession
from app.config import get_settings

COOKIE_NAME = "lit_session"


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(db: AsyncSession, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(days=get_settings().session_days)
    db.add(AuthSession(token_hash=_hash_token(token), user_id=user_id, expires_at=expires_at))
    await db.commit()
    return token


async def user_for_token(db: AsyncSession, token: str | None) -> str | None:
    if not token:
        return None
    return await db.scalar(
        select(AuthSession.user_id).where(
            AuthSession.token_hash == _hash_token(token),
            AuthSession.expires_at > datetime.now(timezone.utc),
        )
    )


async def destroy_session(db: AsyncSession, token: str | None) -> None:
    if not token:
        return
    await db.execute(delete(AuthSession).where(AuthSession.token_hash == _hash_token(token)))
    await db.commit()


def session_cookie(token: str, secure: bool) -> str:
    max_age = get_settings().session_days * 86400
    cookie = f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={max_age}"
    return cookie + "; Secure" if secure else cookie


def clear_session_cookie(secure: bool) -> str:
    cookie = f"{COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    return cookie + "; Secure" if secure else cookie
