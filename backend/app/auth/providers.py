from dataclasses import dataclass
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.passwords import hash_password, verify_password
from app.auth.users import find_user_by_email
from app.config import Settings

# 없는 계정에도 같은 시간이 걸리게 하는 더미 해시(계정 존재 여부가 응답 시간으로 드러나지 않게)
_DUMMY_HASH = hash_password("dummy-password-for-timing")


@dataclass(frozen=True)
class Identity:
    email: str
    name: str
    external_id: str | None = None


class AuthProvider(Protocol):
    name: str
    allows_provisioning: bool

    async def authenticate(self, db: AsyncSession, email: str, password: str) -> Identity | None: ...


class LocalPasswordProvider:
    name = "local"
    allows_provisioning = False

    async def authenticate(self, db: AsyncSession, email: str, password: str) -> Identity | None:
        user = await find_user_by_email(db, email)
        if user is None or user.password_hash is None:
            verify_password(_DUMMY_HASH, password)
            return None
        if not verify_password(user.password_hash, password):
            return None
        return Identity(email=user.email, name=user.name, external_id=user.external_id)


def get_auth_provider(settings: Settings) -> AuthProvider:
    # 사내 메일 공급자는 다음 계획에서 여기에 추가한다.
    if settings.auth_provider == "local":
        return LocalPasswordProvider()
    raise ValueError(f"지원하지 않는 인증 공급자: {settings.auth_provider}")
