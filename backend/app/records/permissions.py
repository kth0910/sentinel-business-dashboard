"""레코드 권한 계산: 원본 frontend/packages/shared/src/permissions.ts의 effectiveRole과
litpage-ref/apps/server/src/records.ts의 recordRole을 옮긴 것.

아직 옮기지 않은 것(해당 기능을 만들 때 추가): 그룹 권한, 제한 멤버(restricted_member), 공개 링크 끄기,
데이터베이스 속성·페이지 단위 접근 규칙, 데모 모드, 에이전트(workflow는 항상 none), roleExtensions·principalResolvers.
"""
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.records.store import get_record, now_ms

# content_only_editor = 데이터베이스의 "내용 편집 가능"(행은 편집, 보기·스키마는 못 바꿈)
RANK: dict[str, float] = {
    "none": 0, "reader": 1, "comment_only": 2, "content_only_editor": 2.5,
    "read_and_write": 3, "editor": 4, "membership_admin": 5, "owner": 6,
}

# 팀 설정으로 고를 수 있는 페이지 역할
PAGE_ROLES = frozenset({"editor", "read_and_write", "comment_only", "reader", "none"})

# 부모를 따라 올라가는 최대 블록 수(원본과 같음, 순환·과도한 깊이 방지)
MAX_WALK = 2000


def _rank(role: Any) -> float:
    return RANK.get(role, 0) if isinstance(role, str) else 0


def max_role(a: str, b: str) -> str:
    return a if _rank(a) >= _rank(b) else b


def role_at_least(role: str | None, minimum: str) -> bool:
    return _rank(role or "none") >= _rank(minimum)


def _perms(rec: dict | None) -> list:
    p = rec.get("permissions") if rec else None
    return p if isinstance(p, list) else []


def _user_perms(space: dict | None, user_id: str):
    for p in _perms(space):
        if isinstance(p, dict) and p.get("type") == "user_permission" and p.get("user_id") == user_id:
            yield p


def space_role_for(space: dict | None, user_id: str) -> str:
    """공간 권한에서 나오는 페이지 역할. owner·membership_admin도 페이지에서는 editor다."""
    role = "none"
    for p in _user_perms(space, user_id):
        r = p.get("role")
        role = max_role(role, "editor" if r in ("owner", "membership_admin") else r)
    return role


def is_space_member(space: dict | None, user_id: str) -> bool:
    return any(p.get("role") != "none" for p in _user_perms(space, user_id))


def is_space_admin(space: dict | None, user_id: str) -> bool:
    return any(p.get("role") in ("owner", "membership_admin") for p in _user_perms(space, user_id))


def _team_access_type(team: dict | None) -> str:
    settings = (team or {}).get("settings")
    t = settings.get("type") if isinstance(settings, dict) else None
    return t if t in ("closed", "private") else "open"


def _team_membership(team: dict | None, user_id: str | None) -> dict | None:
    if not user_id or not team or not isinstance(team.get("membership"), list):
        return None
    for m in team["membership"]:
        if isinstance(m, dict) and m.get("user_id") == user_id:
            return m
    return None


def team_page_role(team: dict | None, user_id: str | None, space_member: bool) -> str:
    """팀 자체로 얻는 팀 직속 페이지 역할(페이지를 따로 공유한 것은 빼고).

    팀 소유자는 editor, 팀 멤버는 settings.default_page_role(기본 editor). 팀 밖 공간 멤버는 open 팀에서만
    settings.workspace_page_role(기본 read_and_write)을 받는다.
    """
    if not team or not user_id:
        return "none"
    settings = team.get("settings") if isinstance(team.get("settings"), dict) else {}
    m = _team_membership(team, user_id)
    if m:
        if m.get("role") == "owner":
            return "editor"
        r = settings.get("default_page_role")
        return r if r in PAGE_ROLES else "editor"
    if not space_member or team.get("archived_by") or _team_access_type(team) != "open":
        return "none"
    r = settings.get("workspace_page_role")
    return r if r in PAGE_ROLES else "read_and_write"


class Lookup:
    """권한 계산이 레코드를 읽는 유일한 통로. 한 요청 안에서 읽은 레코드(없는 것 포함)를 기억한다.

    override(table, rec)는 아직 저장하지 않은 값을 덮어써서, 이후 읽기가 그 값을 보게 한다
    (applyChanges가 호출 안에서 바뀐 상태로 권한을 검사할 때 쓴다).
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self._cache: dict[tuple[str, str], dict | None] = {}

    async def get(self, table: str, id: str | None) -> dict | None:
        if not isinstance(id, str) or not id:
            return None
        key = (table, id)
        if key not in self._cache:
            self._cache[key] = await get_record(self.db, table, id)
        return self._cache[key]

    def override(self, table: str, rec: dict) -> None:
        self._cache[(table, rec["id"])] = rec

    async def block(self, id: str | None) -> dict | None:
        return await self.get("block", id)

    async def space(self, id: str | None) -> dict | None:
        return await self.get("space", id)

    async def team(self, id: str | None) -> dict | None:
        return await self.get("team", id)

    async def collection(self, id: str | None) -> dict | None:
        return await self.get("collection", id)


async def _roles_from(lookup: Lookup, perms: Any, user_id: str, member: bool) -> str | None:
    """블록 하나의 명시적 권한 목록에서 나오는 역할. 해당하는 항목이 없으면 None."""
    if not isinstance(perms, list) or not perms:
        return None
    role = "none"
    explicit = False
    for p in perms:
        if not isinstance(p, dict):
            continue
        kind = p.get("type")
        if kind == "user_permission" and user_id and p.get("user_id") == user_id:
            role, explicit = max_role(role, p.get("role")), True
        elif kind == "team_permission" and member and p.get("team_id"):
            # 팀 멤버에게 준 권한(팀 상속을 끊은 페이지에 기록된다)
            if _team_membership(await lookup.team(p["team_id"]), user_id):
                role, explicit = max_role(role, p.get("role")), True
        elif kind == "space_permission" and member:
            # "<워크스페이스>의 모든 사람"
            role, explicit = max_role(role, p.get("role")), True
        elif kind == "public_permission":
            # 만료된 웹 링크는 아무 권한도 주지 않는다
            expiry = p.get("expiry_time")
            if isinstance(expiry, (int, float)) and expiry and expiry < now_ms():
                continue
            # 웹 링크는 아무나에게 전체 권한(공유 변경)을 주지 않는다: 최대 read_and_write
            r = p.get("role")
            role = max_role(role, "read_and_write" if _rank(r) > RANK["read_and_write"] else r)
            explicit = True
    return role if explicit else None


async def effective_role(lookup: Lookup, block_id: str, user_id: str | None) -> str:
    """블록 `block_id`에 대한 `user_id`의 실제 역할.

    - 조상들의 명시적 권한은 합쳐진다(공유는 아래로 상속되고 더해진다). 다만 부모와 공유를 끊은
      페이지(permissions_unlinked)에서 멈춘다.
    - 비공개 페이지(공간 직속, user_permission만)는 목록에 있는 사람만 본다.
    - 공간 직속 페이지는 권한이 없으면 멤버의 공간 역할로, 팀 직속 페이지는 팀 멤버십으로 정한다.
    """
    role = "none"
    cur = await lookup.block(block_id)
    seen: set[str] = set()
    while cur and cur.get("id") not in seen and len(seen) < MAX_WALK:
        seen.add(cur.get("id"))
        space = await lookup.space(cur.get("space_id"))
        member = bool(user_id) and is_space_member(space, user_id)
        r = await _roles_from(lookup, cur.get("permissions"), user_id or "", member)
        if r:
            role = max_role(role, r)
        if cur.get("permissions_unlinked"):
            break
        parent_table = cur.get("parent_table")
        if parent_table == "space":
            if not _perms(cur) and user_id and member:
                role = max_role(role, space_role_for(space, user_id))
            break
        if parent_table == "team":
            role = max_role(role, team_page_role(await lookup.team(cur.get("parent_id")), user_id, member))
            break
        if parent_table == "collection":
            # 데이터베이스 행은 데이터베이스 블록에서 상속한다(collection의 부모가 그 블록)
            col = await lookup.collection(cur.get("parent_id"))
            cur = await lookup.block(col.get("parent_id")) if col else None
            continue
        if parent_table == "block":
            cur = await lookup.block(cur.get("parent_id"))
            continue
        break
    return role


async def _block_role(lookup: Lookup, block_id: Any, user_id: str | None) -> str:
    return await effective_role(lookup, block_id, user_id) if isinstance(block_id, str) and block_id else "none"


async def record_role(lookup: Lookup, table: str, rec: dict | None, user_id: str | None) -> str:
    """아무 레코드에 대한 사용자의 역할(레코드 맵에 넣을지, 쓰기를 허락할지 정할 때 쓴다)."""
    if not rec:
        return "none"
    match table:
        case "block":
            return await _block_role(lookup, rec.get("id"), user_id)
        case "collection" | "collection_view" | "discussion":
            # collection: 페이지 단위 접근 규칙(일부 행만 보이는 경우)은 아직 없다
            return await _block_role(lookup, rec.get("parent_id"), user_id)
        case "comment":
            d = await lookup.get("discussion", rec.get("parent_id"))
            return await _block_role(lookup, d.get("parent_id"), user_id) if d else "none"
        case "space":
            if not user_id:
                return "none"
            if is_space_admin(rec, user_id):
                return "editor"
            return "read_and_write" if is_space_member(rec, user_id) else "none"
        case "team":
            sp = await lookup.space(rec.get("space_id"))
            if not user_id or not is_space_member(sp, user_id):
                return "none"
            admin = is_space_admin(sp, user_id)
            m = _team_membership(rec, user_id)
            # private 팀은 팀 밖 공간 멤버에게 보이지 않는다
            settings = rec.get("settings") if isinstance(rec.get("settings"), dict) else {}
            if settings.get("type") == "private" and not m and not admin:
                return "none"
            return "editor" if (m and m.get("role") == "owner") or admin else "read_and_write"
        case "space_view":
            return "editor" if user_id and rec.get("parent_id") == user_id else "none"
        case "lit_user":
            if user_id and rec.get("id") == user_id:
                return "editor"
            return "reader" if user_id else "none"
        case "user_root" | "user_settings":
            return "editor" if user_id and rec.get("id") == user_id else "none"
        case "notification" | "page_visit" | "follow":
            # 알림, 누가 어떤 페이지를 방문·팔로우하는지는 본인만 본다
            return "editor" if user_id and rec.get("user_id") == user_id else "none"
        case "automation":
            # 데이터베이스 자동화는 그 데이터베이스를 여는 사람 모두에게 보인다(편집은 API가 따로 검사)
            if rec.get("parent_table") != "collection":
                return "none"
            c = await lookup.collection(rec.get("parent_id"))
            return await _block_role(lookup, c.get("parent_id"), user_id) if c else "none"
        case _:
            # workflow(에이전트)는 아직 없다
            return "none"
