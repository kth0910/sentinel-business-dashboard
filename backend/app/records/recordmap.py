"""레코드 맵 만들기: 원본 litpage-ref/apps/server/src/records.ts의 RecordMapBuilder·UserVisibility를 옮긴 것.

모양: {"__version__": 3, <table>: {<id>: {"spaceId": ..., "value": {"value": <record>, "role": <role>}}}}
데이터베이스 속성 접근 규칙(redactDatabaseRecord)과 데모 모드는 아직 옮기지 않았다.
"""
from app.records.permissions import Lookup, is_space_member, record_role


async def member_space_ids(lookup: Lookup, user_id: str | None) -> list[str]:
    """`user_id`가 멤버인 공간들(자기 space_view를 통해 찾는다)."""
    if not user_id:
        return []
    root = await lookup.get("user_root", user_id)
    views = root.get("space_views") if root else None
    out: list[str] = []
    for sv_id in views if isinstance(views, list) else []:
        sv = await lookup.get("space_view", sv_id)
        if not sv or sv.get("alive") is False or sv.get("parent_id") != user_id:
            continue
        space_id = sv.get("space_id")
        if is_space_member(await lookup.space(space_id), user_id):
            out.append(space_id)
    return out


class UserVisibility:
    """다른 사용자의 이메일을 볼 수 있는 사람: 본인, 그리고 같은 워크스페이스 멤버.

    익명 방문자나 다른 워크스페이스 사람은 이름과 사진만 본다. (원본의 "블록 내용에서 언급된 게스트" 검색은
    아직 옮기지 않았고, 워크스페이스 권한 목록만으로 판단한다.)
    """

    def __init__(self, lookup: Lookup, viewer: str | None):
        self.lookup = lookup
        self.viewer = viewer
        self._co_members: set[str] | None = None

    async def can_see_email(self, user_id: str) -> bool:
        if not self.viewer:
            return False
        if user_id == self.viewer:
            return True
        if self._co_members is None:
            co: set[str] = set()
            for sid in await member_space_ids(self.lookup, self.viewer):
                space = await self.lookup.space(sid)
                for p in (space or {}).get("permissions") or []:
                    if (
                        isinstance(p, dict)
                        and p.get("type") == "user_permission"
                        and p.get("user_id")
                        and p.get("role") != "none"
                    ):
                        co.add(p["user_id"])
            self._co_members = co
        return user_id in self._co_members

    async def user(self, rec: dict) -> dict:
        """이 사람이 볼 수 있는 모양의 lit_user 레코드(원본은 바꾸지 않는다)."""
        if not rec.get("email") or await self.can_see_email(rec.get("id")):
            return rec
        return {k: v for k, v in rec.items() if k != "email"}


class RecordMapBuilder:
    def __init__(self, lookup: Lookup, user_id: str | None):
        self.lookup = lookup
        self.user_id = user_id
        self.users = UserVisibility(lookup, user_id)
        self.map: dict = {"__version__": 3}

    async def add(self, table: str, rec: dict | None, role: str | None = None) -> None:
        """레코드를 역할과 함께 넣는다. 역할이 none이면 뺀다(lit_user는 이름을 보여야 해서 넣는다)."""
        if not rec:
            return
        r = role if role is not None else await record_role(self.lookup, table, rec, self.user_id)
        if r == "none" and table != "lit_user":
            return
        value = await self.users.user(rec) if table == "lit_user" else rec
        self.map.setdefault(table, {})[rec["id"]] = {"spaceId": rec.get("space_id"), "value": {"value": value, "role": r}}

    def has(self, table: str, id: str) -> bool:
        bucket = self.map.get(table)
        return isinstance(bucket, dict) and id in bucket
