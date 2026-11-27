from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.passwords import hash_password

if TYPE_CHECKING:
    from app.auth.providers import Identity


def normalize_email(email: str) -> str:
    return email.strip().lower()


async def find_user_by_email(db: AsyncSession, email: str) -> User | None:
    return await db.scalar(select(User).where(User.email == normalize_email(email)))


async def create_user(
    db: AsyncSession,
    email: str,
    name: str,
    password: str | None,
    is_admin: bool = False,
    auth_source: str = "local",
    external_id: str | None = None,
) -> User:
    email = normalize_email(email)
    if await find_user_by_email(db, email) is not None:
        raise ValueError("이미 등록된 이메일입니다.")
    user = User(
        email=email,
        name=name,
        password_hash=hash_password(password) if password is not None else None,
        auth_source=auth_source,
        external_id=external_id,
        is_admin=is_admin,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("이미 등록된 이메일입니다.") from None
    return user


async def provision_external_user(db: AsyncSession, identity: "Identity", source: str) -> User:
    if identity.external_id is not None:
        user = await db.scalar(
            select(User).where(User.auth_source == source, User.external_id == identity.external_id)
        )
        if user is not None:
            return user
    user = await find_user_by_email(db, identity.email)
    if user is not None:
        return user
    return await create_user(
        db, identity.email, identity.name, None, auth_source=source, external_id=identity.external_id
    )
