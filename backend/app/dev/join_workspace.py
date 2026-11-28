from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.users import find_user_by_email
from app.records.seed import add_member, ensure_user_records
from app.records.store import get_record


async def join_workspace(db: AsyncSession, email: str, space_id: str, role: str, app_env: str) -> None:
    """개발용: 기존 사용자를 워크스페이스에 넣고 커밋한다. 정식 초대 기능이 아니다."""
    if app_env == "production":
        raise RuntimeError("운영 환경에서는 이 명령을 쓸 수 없습니다.")
    user = await find_user_by_email(db, email)
    if user is None:
        raise ValueError(f"등록되지 않은 이메일입니다: {email}")
    if await get_record(db, "space", space_id) is None:
        raise ValueError(f"워크스페이스를 찾을 수 없습니다: {space_id}")
    await ensure_user_records(db, user)
    await add_member(db, space_id, user.id, role)
    await db.commit()
