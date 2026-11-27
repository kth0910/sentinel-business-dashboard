from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.users import create_user, find_user_by_email

SAMPLE_USERS: list[tuple[str, str, bool]] = [
    ("admin@example.com", "관리자", True),
    ("hong@example.com", "홍길동", False),
    ("kim@example.com", "김철수", False),
]


async def seed_sample_users(db: AsyncSession, password: str, app_env: str) -> int:
    if app_env == "production":
        raise RuntimeError("운영 환경에서는 샘플 계정을 만들 수 없습니다.")
    created = 0
    for email, name, is_admin in SAMPLE_USERS:
        if await find_user_by_email(db, email) is None:
            await create_user(db, email, name, password, is_admin=is_admin)
            created += 1
    return created
