"""허브의 접근 확인 콜백: 호출마다 짧게 쓰는 DB 세션을 새로 열어 권한 함수로 계산한다(원본 app.ts의 setAccess)."""
from app.db import SessionLocal
from app.records.permissions import Lookup, effective_role, is_space_member, record_role
from app.records.recordmap import UserVisibility


class DbAccess:
    async def page(self, page_id: str, user_id: str) -> bool:
        async with SessionLocal() as db:
            return await effective_role(Lookup(db), page_id, user_id) != "none"

    async def space(self, space_id: str, user_id: str) -> bool:
        async with SessionLocal() as db:
            return is_space_member(await Lookup(db).space(space_id), user_id)

    async def role(self, table: str, rec: dict, user_id: str) -> str:
        async with SessionLocal() as db:
            return await record_role(Lookup(db), table, rec, user_id)

    async def view(self, table: str, rec: dict, user_id: str) -> dict:
        if table != "lit_user":
            return rec  # 데이터베이스 속성 접근 규칙(redactDatabaseRecord)은 아직 옮기지 않았다
        async with SessionLocal() as db:
            return await UserVisibility(Lookup(db), user_id).user(rec)
