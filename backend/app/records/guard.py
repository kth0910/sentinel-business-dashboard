"""applyChanges의 쓰기 권한 검사: 원본 litpage-ref/apps/server/src/authz.ts의 validateOp·stripServerOwned·TxGuard를
옮긴 것.

모든 연산은 호출 안의 상태(같은 요청의 앞선 연산이 만들거나 바꾼 레코드 포함)를 기준으로 검사한다.
  - 연산마다(check_op): 연산 전 레코드에 대한 역할, 필드별 규칙(공유 변경은 전체 권한, 댓글은 작성자만, 팀 멤버
    변경은 스스로 들어가기·나가기만, 서버 관리 필드는 읽기 전용 …)
  - 호출 끝에(finalize): 이번 호출에서 만든 레코드는 쓸 수 있는(댓글은 댓글 달 수 있는) 부모 아래에 있어야 하고,
    옮긴 블록·컬렉션은 쓸 수 있는 부모로 가야 하며, space_id는 부모를 따른다. 목록 필드에 새로 들어간 ID와
    다른 레코드를 가리키는 포인터는 사용자가 읽을 수 있는 레코드여야 한다(남의 블록을 내 페이지로 "입양" 금지).
함수들은 허락하지 않을 때 사유 문자열을 돌려준다(apply.py가 403으로 바꾼다).

옮기지 않은 것(이번 범위 밖): 데이터베이스 잠금·속성 접근(dbaccess.ts), 댓글 권한자의 제안 편집, 워크스페이스
보안 정책(policy.ts — 단, 팀 사이드바 편집 제한 teamSidebarProblem은 팀 권한의 일부라 옮겼다), 데모, 검증
(verification), 스키마 크기 제한, 에이전트 접근 설정.
"""
import json
import math
from typing import TYPE_CHECKING, Any

from app.records.ops import COMMANDS, UNSAFE_KEYS
from app.records.permissions import (
    Lookup,
    effective_role,
    is_space_admin,
    is_space_member,
    max_role,
    role_at_least,
    space_role_for,
)
from app.records.store import TABLES

if TYPE_CHECKING:
    from app.records.apply import Change

TABLE_SET = frozenset(TABLES)
# 서버가 관리하는 필드: 클라이언트 연산으로는 절대 받지 않는다
SERVER_OWNED = frozenset({"version", "applied_tx_ids"})
MAX_ID = 200
MAX_PATH = 16
MAX_PATH_SEGMENT = 256
RICH_TEXT_SPLICE_ROOTS = frozenset({"title", "name", "description", "text", "caption"})

# 클라이언트가 만들면 작성자를 서버가 현재 사용자로 덮어쓰는 레코드
_AUTHORED = ("block", "collection", "collection_view", "discussion", "comment", "team")
# 페이지에 붙어 있어야 하는 레코드(부모를 따라가면 원래 있던 레코드에 닿아야 한다)
_ATTACHED = ("block", "collection", "collection_view", "discussion", "comment")

# 목록 필드 → 가리키는 레코드 종류. 새로 들어간 ID는 읽을 수 있는 레코드여야 한다.
LISTS: dict[str, dict[str, str]] = {
    "block": {"content": "block", "view_ids": "collection_view", "discussions": "discussion"},
    "space": {"pages": "block", "default_team_ids": "team"},
    "team": {"team_pages": "block"},
    "space_view": {"private_pages": "block", "bookmarked_pages": "block", "joined_teams": "team"},
    "collection": {"template_pages": "block"},
    "discussion": {"comments": "comment"},
}

# space에서 applyChanges로는 바꿀 수 없는 필드(전용 API가 생기면 그쪽에서 바꾼다)
_SPACE_FORBIDDEN = (
    "permissions", "plan_type", "domain", "invite_link_code", "created_by_id", "created_time",
    "deleted_time", "deleted_by_id",
)
# 바뀌면 역할 계산이 달라질 수 있는 블록 필드(역할 캐시를 비운다)
_STRUCTURAL_KEYS = (
    "permissions", "permissions_unlinked", "parent_id", "parent_table", "membership", "settings", "space_id",
    "alive", "collection_id",
)

_INT64_MIN, _INT64_MAX = -(2**63), 2**63 - 1
_MAX_ARGS_DEPTH = 40
_MAX_ARGS_NODES = 200_000
_MAX_RECORD_DEPTH = 100


def _d(v: Any) -> dict:
    return v if isinstance(v, dict) else {}


def _l(v: Any) -> list:
    return v if isinstance(v, list) else []


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def _json_key(v: Any) -> str:
    # 원본 stableJson처럼 키 순서와 상관없이 같은 값이면 같다. True와 1처럼 JS에서 다른 값은 다르게 본다.
    return json.dumps(v, sort_keys=True, separators=(",", ":"))


def same(a: Any, b: Any) -> bool:
    if a is b:
        return True
    return _json_key(a) == _json_key(b)


def bad_string(s: str) -> bool:
    """PostgreSQL(JSONB·text)에 저장할 수 없는 문자열: NUL 문자, 짝 잃은 서로게이트."""
    if s.isascii():
        return "\x00" in s
    try:
        s.encode("utf-8")
    except UnicodeEncodeError:
        return True
    return "\x00" in s


def _bad_value(v: Any, depth: int, budget: list[int], check_keys: bool, max_depth: int) -> bool:
    """위험한 키(check_keys일 때), 저장할 수 없는 문자열, 유한하지 않은 숫자, 너무 깊거나 큰 값이 있으면 True."""
    if isinstance(v, str):
        return bad_string(v)
    if isinstance(v, float):
        return not math.isfinite(v)
    if not isinstance(v, (dict, list)):
        return False
    budget[0] += 1
    if depth > max_depth or budget[0] > _MAX_ARGS_NODES:
        return True
    if isinstance(v, list):
        return any(_bad_value(x, depth + 1, budget, check_keys, max_depth) for x in v)
    for k, x in v.items():
        if not isinstance(k, str) or (check_keys and k in UNSAFE_KEYS) or bad_string(k):
            return True
        if _bad_value(x, depth + 1, budget, check_keys, max_depth):
            return True
    return False


def _bad_id(v: Any) -> bool:
    return not isinstance(v, str) or not v or len(v) > MAX_ID or bad_string(v)


def _rich_text_problem(rt: Any) -> str | None:
    """splice로 넣을 리치 텍스트 모양: [[글자], [글자, [[주석키, ...], ...]], ...]."""
    if not isinstance(rt, list):
        return "Invalid splice"
    for piece in rt:
        if not isinstance(piece, list) or len(piece) not in (1, 2) or not isinstance(piece[0], str):
            return "Invalid rich text"
        anns = piece[1] if len(piece) == 2 else None
        if anns is None:
            continue
        if not isinstance(anns, list):
            return "Invalid rich text"
        for a in anns:
            if not isinstance(a, list) or not a or not isinstance(a[0], str):
                return "Invalid rich text"
    return None


def validate_op(op: Any) -> str | None:
    """모든 연산의 모양 검사. 문제가 있으면 사유를 돌려준다(→ 400)."""
    if not isinstance(op, dict):
        return "Invalid operation"
    p = op.get("pointer")
    if not isinstance(p, dict) or p.get("table") not in TABLE_SET:
        return "Invalid table"
    if _bad_id(p.get("id")):
        return "Invalid record id"
    space_id = p.get("spaceId")
    if space_id is not None and (not isinstance(space_id, str) or len(space_id) > MAX_ID or bad_string(space_id)):
        return "Invalid space id"
    command = op.get("command")
    if command not in COMMANDS:
        return f"Unknown command {command!r}"
    path = op.get("path")
    if not isinstance(path, list) or len(path) > MAX_PATH or any(
        not isinstance(s, str) or len(s) > MAX_PATH_SEGMENT or s in UNSAFE_KEYS or bad_string(s) for s in path
    ):
        return "Invalid path"
    if path and path[0] in SERVER_OWNED:
        return f"{path[0]} is server-owned"
    args = op.get("args")
    match command:
        case "update":
            if not isinstance(args, dict):
                return "update expects an object"
        case "listAfter" | "listBefore" | "listRemove":
            if not path:
                return "list operations need a path"
            if not isinstance(args, dict) or _bad_id(args.get("id")):
                return "Invalid list id"
            for anchor in ("after", "before"):
                if args.get(anchor) is not None and not isinstance(args.get(anchor), str):
                    return "Invalid list anchor"
        case "spliceText":
            ok = (len(path) == 2 and path[0] == "properties") or (len(path) == 1 and path[0] in RICH_TEXT_SPLICE_ROOTS)
            if not ok:
                return "spliceText is only valid on rich-text properties"
            if (
                not isinstance(args, dict)
                or not isinstance(args.get("base"), str)
                or not _is_int(args.get("start"))
                or not _is_int(args.get("end"))
                or args["start"] < 0
                or args["end"] < args["start"]
            ):
                return "Invalid splice"
            problem = _rich_text_problem(args.get("insert"))
            if problem:
                return problem
    if _bad_value(args, 0, [0], True, _MAX_ARGS_DEPTH):
        return "Invalid operation arguments"
    return None


def strip_server_owned(op: dict) -> None:
    """클라이언트 연산의 인자에서 서버 관리 필드를 지운다(제자리에서)."""
    if op.get("command") in ("set", "update") and not op.get("path") and isinstance(op.get("args"), dict):
        for k in SERVER_OWNED:
            op["args"].pop(k, None)


def _int64_or_missing(rec: dict, key: str) -> bool:
    v = rec.get(key)
    return v is None or (_is_int(v) and _INT64_MIN <= v <= _INT64_MAX)


def record_shape_problem(table: str, rec: dict) -> str | None:
    """저장하기 직전 레코드가 DB에 들어갈 수 있는 모양인지(→ 400). 색인 열(parent_id·space_id·alive·
    last_edited_time)의 타입, JSONB가 받지 않는 문자열·숫자, 정수로 정렬·변환하는 page_visit 숫자를 본다."""
    for key in ("parent_id", "parent_table", "space_id"):
        v = rec.get(key)
        if v is not None and not isinstance(v, str):
            return f"{key} must be a string"
        # B-tree 색인 열이라 너무 긴 값은 색인에 들어가지 않는다(500 대신 400)
        if isinstance(v, str) and len(v) > MAX_ID:
            return f"{key} is too long"
    if rec.get("alive") is not None and not isinstance(rec.get("alive"), bool):
        return "alive must be a boolean"
    if not _int64_or_missing(rec, "last_edited_time"):
        return "last_edited_time must be an integer"
    if table == "page_visit":
        # listRecentPages가 visited_at을 BIGINT로 바꿔 정렬한다
        for key in ("visited_at", "total_visits"):
            if not _int64_or_missing(rec, key):
                return f"{key} must be an integer"
    if _bad_value(rec, 0, [0], False, _MAX_RECORD_DEPTH):
        return "Record contains values that cannot be stored"
    return None


def changed_keys(before: dict | None, after: dict, op: dict) -> set[str]:
    """두 버전 사이에 값이 달라진 최상위 키(서버 관리 필드는 뺀다)."""
    path = op.get("path") or []
    b = before or {}
    if path:
        return {path[0]} if not same(b.get(path[0]), after.get(path[0])) else set()
    if op.get("command") == "update":
        keys = list(_d(op.get("args")).keys())
    else:
        keys = list({*b.keys(), *after.keys()})
    return {k for k in keys if k not in SERVER_OWNED and not same(b.get(k), after.get(k))}


def _ids_of(v: Any) -> list[str]:
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def added_ids(before: Any, after: Any) -> list[str]:
    prev = set(_ids_of(before))
    return [x for x in _ids_of(after) if x not in prev]


def _members(space: dict | None) -> set[str]:
    return {
        p["user_id"] for p in _l((space or {}).get("permissions"))
        if isinstance(p, dict) and isinstance(p.get("user_id"), str) and p.get("role") != "none"
    }


def _membership(team: dict) -> list[dict]:
    return [m for m in _l(team.get("membership")) if isinstance(m, dict)]


def _is_space_owner(space: dict | None, user_id: str) -> bool:
    return any(
        isinstance(p, dict) and p.get("type") == "user_permission" and p.get("user_id") == user_id
        and p.get("role") == "owner"
        for p in _l((space or {}).get("permissions"))
    )


def _team_sidebar_problem(team: dict, user_id: str) -> str | None:
    """원본 policy.ts teamSidebarProblem: 팀 사이드바(team_pages)를 누가 고칠 수 있는지."""
    if any(m.get("user_id") == user_id and m.get("role") == "owner" for m in _membership(team)):
        return None
    s = _d(team.get("settings"))
    if s.get("sidebar_edit") == "owners":
        return "Only team owners can edit the team sidebar"
    if str(s.get("default_page_role") or "editor") in ("comment_only", "reader"):
        return "Only team owners can edit the team sidebar"
    return None


class TxGuard:
    def __init__(self, lookup: Lookup, user_id: str, changed: "dict[str, Change]"):
        # lookup에는 apply.py가 호출 안에서 바뀐 레코드를 override로 넣어 둔다(읽으면 호출 안의 값이 나온다)
        self.lookup = lookup
        self.user_id = user_id
        self.changed = changed
        # 이번 호출에서 만든 레코드의 "table:id"(순서를 지키려고 dict를 집합처럼 쓴다)
        self.created: dict[str, None] = {}
        # 부모가 바뀐 기존 레코드(finalize에서 최종 상태로 다시 검사)
        self.moved: dict[str, None] = {}
        # 처음 건드릴 때의 저장된 값(만든 레코드는 None). 읽기만 한다.
        self.stored: dict[str, dict | None] = {}
        self._role_cache: dict[str, str] = {}
        self._structural = False

    async def get(self, table: str, id: Any) -> dict | None:
        """호출 안의 현재 값(앞선 연산이 바꿨으면 그 값) 또는 저장된 값. 돌려받은 dict는 바꾸지 않는다."""
        return await self.lookup.get(table, id) if isinstance(id, str) and id else None

    async def role(self, block_id: Any) -> str:
        """호출 안의 상태로 본 블록 역할. 이번 호출에서 만든 블록은 만든 사람이 전체 권한을 가진다."""
        if not isinstance(block_id, str) or not block_id:
            return "none"
        hit = self._role_cache.get(block_id)
        if hit:
            return hit
        r = await effective_role(self.lookup, block_id, self.user_id)
        if f"block:{block_id}" in self.created:
            r = max_role(r, "editor")
        self._role_cache[block_id] = r
        return r

    async def _can_read_block(self, id: str) -> bool:
        return f"block:{id}" in self.created or await self.role(id) != "none"

    async def _collection_role(self, c: dict | None) -> str:
        if not c:
            return "none"
        if f"collection:{c.get('id')}" in self.created:
            return "editor"
        return await self.role(c.get("parent_id"))

    async def _discussion_role(self, d: dict | None) -> str:
        return await self.role(d.get("parent_id")) if d else "none"

    async def check_op(self, op: dict, before: dict | None, after: dict) -> str | None:
        """연산 하나 검사. `before`는 연산 전 호출 안의 값, `after`는 결과. 사유 또는 None."""
        key = f"{op['pointer']['table']}:{op['pointer']['id']}"
        if key not in self.changed:
            self.stored[key] = before  # 처음 건드림: 저장된 값(없으면 None)
        res = await self._decide(op, before, after)
        # 이 연산 전 상태로 계산한 역할이 다음 연산으로 새지 않게 한다
        if self._structural:
            self._role_cache.clear()
        self._structural = False
        return res

    async def _decide(self, op: dict, b: dict | None, a: dict) -> str | None:
        table = op["pointer"]["table"]
        rid = op["pointer"]["id"]
        key = f"{table}:{rid}"
        uid = self.user_id
        if a.get("id") != rid:
            return "Record id mismatch"
        keys = changed_keys(b, a, op)

        if b is None:
            # ---------------------------------------------------------------- 생성
            self.created[key] = None
            self._structural = True
            return await self._creation_problem(table, rid, a)

        # ------------------------------------------------------------------ 기존 레코드 수정
        if key in self.created:
            # 이번 호출에서 만든 것: 만든 사람이 계속 다듬을 수 있다. 생성 규칙(작성자·주인·팀·부모·포인터)은
            # finalize가 최종 값으로 다시 검사한다.
            self._structural = True
            return None
        if not keys:
            return None
        if "id" in keys:
            return "Record ids cannot change"
        if any(k in keys for k in _STRUCTURAL_KEYS):
            self._structural = True
        match table:
            case "block":
                role = await self.role(rid)
                if "space_id" in keys:
                    return "Blocks cannot change workspace"
                if "created_by_id" in keys or "created_time" in keys:
                    return "Authorship can't be changed"
                if ("permissions" in keys or "permissions_unlinked" in keys) and not role_at_least(role, "editor"):
                    return "Only people with full access can change sharing"
                if "parent_id" in keys or "parent_table" in keys:
                    self.moved[key] = None
                if keys == {"discussions"} and not role_at_least(role, "read_and_write"):
                    if not role_at_least(role, "comment_only"):
                        return "Not allowed"
                    # 댓글 권한자는 스레드를 붙이고 자기 스레드만 뗄 수 있다(남의 스레드를 숨기지 못함)
                    for did in added_ids(a.get("discussions"), b.get("discussions")):
                        if _d(await self.get("discussion", did)).get("created_by_id") != uid:
                            return "Not allowed"
                    return None
                return None if role_at_least(role, "read_and_write") else "Not allowed"
            case "collection" | "collection_view":
                if "space_id" in keys:
                    return "Records cannot change workspace"
                if not role_at_least(await self.role(b.get("parent_id")), "read_and_write"):
                    return "Not allowed"
                if "parent_id" in keys or "parent_table" in keys:
                    self.moved[key] = None
                return None
            case "space":
                if any(k in keys for k in _SPACE_FORBIDDEN):
                    return "Use the workspace settings API for this change"
                if "pages" in keys and not role_at_least(space_role_for(b, uid), "read_and_write"):
                    return "Not allowed"
                if keys == {"pages"}:
                    return None
                # 나머지 공간 설정은 소유자만
                return None if _is_space_owner(b, uid) else "Only workspace owners can change workspace settings"
            case "space_view":
                if b.get("parent_id") != uid or a.get("parent_id") != uid:
                    return "Not your sidebar"
                if "space_id" in keys or "parent_table" in keys:
                    return "Not allowed"
                return None
            case "team":
                return await self._check_team(b, a, keys)
            case "discussion":
                return await self._check_discussion(b, a, keys)
            case "comment":
                return await self._check_comment(b, a, keys)
            case "lit_user":
                if rid != uid:
                    return "Not your account"
                if "email" in keys or "created_time" in keys:
                    return "This field can't be changed here"
                return None
            case "user_root":
                if rid != uid:
                    return "Not your account"
                for sv_id in added_ids(b.get("space_views"), a.get("space_views")):
                    sv = await self.get("space_view", sv_id)
                    if not sv or sv.get("parent_id") != uid:
                        return "Not your sidebar"
                return None
            case "user_settings":
                return None if rid == uid else "Not your account"
            case "notification":
                if b.get("user_id") != uid or a.get("user_id") != uid:
                    return "Not your notification"
                fixed = ("user_id", "space_id", "type", "actor_id", "navigable_block_id", "activity", "created_time",
                         "discussion_id", "comment_id")
                return "Not allowed" if any(k in keys for k in fixed) else None
            case "follow" | "page_visit":
                if b.get("user_id") != uid or a.get("user_id") != uid:
                    return "Not your record"
                if "navigable_block_id" in keys or "parent_id" in keys or "space_id" in keys:
                    return "Not allowed"
                return None
            case _:
                return "Unknown table"

    async def _creation_problem(self, table: str, rid: str, a: dict) -> str | None:
        """새 레코드의 생성 규칙. 생성 연산 때 한 번, 그리고 같은 호출의 뒤 연산이 값을 바꿨을 수 있으므로
        finalize에서 최종 값으로 한 번 더 부른다(작성자 도장도 다시 찍는다). 부모는 _parent_problem이 본다."""
        uid = self.user_id
        if table in _AUTHORED:
            a["created_by_id"] = uid  # 작성자는 클라이언트가 정하지 않는다(사칭 방지)
            if table == "block":
                a["created_by_table"] = "lit_user"
        match table:
            case "block":
                return None if isinstance(a.get("type"), str) else "Blocks need a type"
            case "collection" | "collection_view" | "discussion" | "comment":
                return None
            case "space":
                return "Workspaces are created with createWorkspace"
            case "space_view":
                return None if a.get("parent_id") == uid else "Not your sidebar"
            case "team":
                space = await self.get("space", a.get("space_id"))
                if not is_space_member(space, uid):
                    return "Not a member of this workspace"
                if a.get("parent_table") != "space" or a.get("parent_id") != a.get("space_id"):
                    return "Teamspaces live in their workspace"
                members = _members(space)
                membership = a.get("membership")
                if membership is not None and not isinstance(membership, list):
                    return "Invalid membership"
                if any(not isinstance(m, dict) or m.get("user_id") not in members for m in membership or []):
                    return "Teamspace members must be workspace members"
                return None
            case "lit_user" | "user_root" | "user_settings":
                return None if rid == uid and a.get("id") == uid else "Not your account"
            case "notification" | "page_visit":
                return None if a.get("user_id") == uid else "Not your record"
            case "follow":
                if a.get("user_id") != uid:
                    return "Not your record"
                nav = a.get("navigable_block_id")
                return None if nav and await self.role(nav) != "none" else "Not found"
            case _:
                return "Unknown table"

    async def _check_team(self, b: dict, a: dict, keys: set[str]) -> str | None:
        uid = self.user_id
        if "space_id" in keys or "parent_id" in keys or "parent_table" in keys:
            return "Teamspaces cannot move"
        space = await self.get("space", b.get("space_id"))
        if not is_space_member(space, uid):
            return "Not a member of this workspace"
        before_members = _membership(b)
        if "membership" in keys and a.get("membership") is not None and not isinstance(a.get("membership"), list):
            return "Invalid membership"
        is_owner = any(m.get("user_id") == uid and m.get("role") == "owner" for m in before_members)
        if is_owner or is_space_admin(space, uid):
            members = _members(space)
            if "membership" in keys and any(
                not isinstance(m, dict) or m.get("user_id") not in members for m in _l(a.get("membership"))
            ):
                return "Teamspace members must be workspace members"
            return None
        in_team = any(m.get("user_id") == uid for m in before_members)
        is_open = (_d(b.get("settings")).get("type") or "open") == "open"
        for k in keys:
            if k == "team_pages":
                if not in_team and not is_open:
                    return "Join this team first"
                problem = _team_sidebar_problem(b, uid)
                if problem:
                    return problem
                continue
            if k == "membership":
                after_members = _l(a.get("membership"))
                prev = [_json_key(m) for m in before_members]
                nxt = [_json_key(m) for m in after_members]
                removed = [m for i, m in enumerate(before_members) if prev[i] not in nxt]
                added = [m for i, m in enumerate(after_members) if nxt[i] not in prev]
                self_leave = not added and len(removed) >= 1 and all(m.get("user_id") == uid for m in removed)
                self_join = (
                    not removed and len(added) == 1 and isinstance(added[0], dict)
                    and added[0].get("user_id") == uid and added[0].get("role") == "member" and not in_team and is_open
                )
                # 팀 설정의 "멤버 초대 권한"(policy.ts memberInviteAllowed)은 아직 없다: 소유자만 멤버를 관리한다
                if not self_leave and not self_join:
                    return "Only team owners can manage members"
                continue
            return "Only team owners can change team settings"
        return None

    async def _check_discussion(self, b: dict, a: dict, keys: set[str]) -> str | None:
        uid = self.user_id
        if any(k in keys for k in ("parent_id", "parent_table", "space_id", "created_by_id")):
            return "Not allowed"
        role = await self._discussion_role(b)
        if role_at_least(role, "read_and_write"):
            return None  # 페이지 편집자는 토론을 관리한다
        if not role_at_least(role, "comment_only"):
            return "Not allowed"
        for k in keys:
            if k in ("resolved", "resolved_by_id", "resolved_time"):
                continue
            if k == "comments":
                for cid in added_ids(a.get("comments"), b.get("comments")):
                    if _d(await self.get("comment", cid)).get("created_by_id") != uid:
                        return "Not allowed"
                continue
            if k == "muted_user_ids":
                prev, nxt = set(_ids_of(b.get("muted_user_ids"))), set(_ids_of(a.get("muted_user_ids")))
                if any(x != uid for x in prev ^ nxt):
                    return "Not allowed"
                continue
            if k == "alive" and b.get("created_by_id") == uid:
                continue
            # 자기 제안을 거두면(Reject) 어떻게 끝났는지 남긴다
            if (
                k in ("suggestion_status", "suggestion_summary") and b.get("created_by_id") == uid
                and b.get("type") == "suggestion" and a.get("suggestion_status") != "accepted"
            ):
                continue
            return "Not allowed"
        return None

    async def _check_comment(self, b: dict, a: dict, keys: set[str]) -> str | None:
        uid = self.user_id
        if any(k in keys for k in ("parent_id", "parent_table", "space_id", "created_by_id", "created_time")):
            return "Not allowed"
        role = await self._discussion_role(await self.get("discussion", b.get("parent_id")))
        if not role_at_least(role, "comment_only"):
            return "Not allowed"
        author = b.get("created_by_id") == uid
        for k in keys:
            if k == "reactions":
                prev, nxt = _d(b.get("reactions")), _d(a.get("reactions"))
                for emoji in {*prev.keys(), *nxt.keys()}:
                    if any(x != uid for x in set(_ids_of(prev.get(emoji))) ^ set(_ids_of(nxt.get(emoji)))):
                        return "You can only add or remove your own reactions"
                continue
            if k == "alive" and (author or role_at_least(role, "read_and_write")):
                continue
            if k in ("text", "last_edited_time", "edited") and author:
                continue
            return "Only the author can edit this comment"
        return None

    async def _parent_problem(self, table: str, r: dict) -> str | None:
        """만들거나 옮긴 레코드의 부모는 쓸 수 있어야(블록·컬렉션) 또는 댓글 달 수 있어야(토론·댓글) 한다.
        space_id(와 parent_table)는 부모를 따라 맞춘다."""
        uid = self.user_id
        match table:
            case "block":
                pt = r.get("parent_table")
                if pt == "block":
                    p = await self.get("block", r.get("parent_id"))
                    if not p:
                        return "Parent block not found"
                    if not role_at_least(await self.role(p["id"]), "read_and_write"):
                        return "Not allowed to add content here"
                    r["space_id"] = p.get("space_id")
                    return None
                if pt == "collection":
                    c = await self.get("collection", r.get("parent_id"))
                    if not c:
                        return "Database not found"
                    if not role_at_least(await self._collection_role(c), "read_and_write"):
                        return "Not allowed to add rows here"
                    host = await self.get("block", c.get("parent_id"))
                    r["space_id"] = c.get("space_id") or (host or {}).get("space_id") or r.get("space_id")
                    return None
                if pt == "space":
                    if not is_space_member(await self.get("space", r.get("parent_id")), uid):
                        return "Not a member of this workspace"
                    r["space_id"] = r.get("parent_id")
                    return None
                if pt == "team":
                    t = await self.get("team", r.get("parent_id"))
                    if not t or t.get("alive") is False:
                        return "Teamspace not found"
                    if not is_space_member(await self.get("space", t.get("space_id")), uid):
                        return "Not a member of this workspace"
                    in_team = any(m.get("user_id") == uid for m in _membership(t))
                    if not in_team and (_d(t.get("settings")).get("type") or "open") != "open":
                        return "Join this team first"
                    r["space_id"] = t.get("space_id")
                    return None
                return "Invalid parent"
            case "collection" | "collection_view":
                p = await self.get("block", r.get("parent_id"))
                if not p:
                    return "Parent block not found"
                if not role_at_least(await self.role(p["id"]), "read_and_write"):
                    return "Not allowed"
                r["parent_table"] = "block"
                r["space_id"] = p.get("space_id")
                return None
            case "discussion":
                p = await self.get("block", r.get("parent_id"))
                if not p:
                    return "Block could not be found"
                if not role_at_least(await self.role(p["id"]), "comment_only"):
                    return "Not allowed to comment here"
                r["parent_table"] = "block"
                r["space_id"] = p.get("space_id")
                return None
            case "comment":
                d = await self.get("discussion", r.get("parent_id"))
                if not d:
                    return "Discussion not found"
                if not role_at_least(await self._discussion_role(d), "comment_only"):
                    return "Not allowed to comment here"
                r["parent_table"] = "discussion"
                r["space_id"] = d.get("space_id")
                return None
            case _:
                return None

    async def _anchored(self, table: str, r: dict) -> bool:
        """이번 호출에서 만든 레코드는 원래 있던 무언가의 아래에 달려야 한다(떠 있는 섬·순환 금지)."""
        seen: set[str] = set()
        cur_table = table
        cur: dict | None = r
        for _ in range(500):
            if not cur:
                return False
            key = f"{cur_table}:{cur.get('id')}"
            if key in seen:
                return False
            seen.add(key)
            if key not in self.created:
                return True
            nxt: str | None = None
            if cur_table == "comment":
                nxt = "discussion"
            elif cur_table == "block":
                pt = cur.get("parent_table")
                nxt = pt if pt in ("block", "collection") else None
            elif cur_table in ("collection", "collection_view", "discussion"):
                nxt = "block"
            if not nxt:
                return True  # space·team 뿌리는 _parent_problem이 확인했다
            cur = await self.get(nxt, cur.get("parent_id"))
            cur_table = nxt
        return False

    async def finalize(self) -> str | None:
        """호출 끝의 최종 상태로 검사하고 space_id를 맞춘다. 사유 또는 None."""
        self._role_cache.clear()
        for key in [*self.created, *self.moved]:
            ch = self.changed.get(key)
            if not ch:
                continue
            r = ch.record
            problem = await self._parent_problem(ch.table, r)
            if problem:
                return f"{problem} ({key})"
            # 레코드는 워크스페이스 사이를 옮기지 않는다(하위 트리가 남겨진다)
            if key not in self.created:
                stored = self.stored.get(key) or {}
                if stored.get("space_id") and r.get("space_id") and stored["space_id"] != r["space_id"]:
                    return f"Pages can only be duplicated to another workspace, not moved ({key})"
            if key in self.created:
                # 같은 호출의 뒤 연산이 바꿨을 수 있는 최종 값으로 생성 규칙을 다시 본다(space_id는 위에서 맞췄다)
                problem = await self._creation_problem(ch.table, r.get("id"), r)
                if problem:
                    return f"{problem} ({key})"
            if key in self.created and ch.table in _ATTACHED and not await self._anchored(ch.table, r):
                return f"Record is not attached to a page ({key})"
            if r.get("space_id"):
                ch.space_id = r["space_id"]
        for key, ch in self.changed.items():
            r = ch.record
            prev = self.stored.get(key) or {}
            # 목록 필드에 새로 들어간 항목은 읽을 수 있는 레코드(또는 이 레코드의 자식)여야 한다
            for field, target in LISTS.get(ch.table, {}).items():
                for id_ in added_ids(prev.get(field), r.get(field)):
                    problem = await self._list_entry_problem(ch.table, r, field, target, id_)
                    if problem:
                        return f"{problem} ({key} {field})"
            # 다른 레코드를 가리키는 포인터
            fmt, prev_fmt = _d(r.get("format")), _d(prev.get("format"))
            if ch.table == "block":
                cid = r.get("collection_id")
                if cid and cid != prev.get("collection_id") and f"collection:{cid}" not in self.created:
                    c = await self.get("collection", cid)
                    if not c or await self._collection_role(c) == "none":
                        return f"Database not found ({key})"
                fcid = _d(fmt.get("collection_pointer")).get("id")
                if (
                    isinstance(fcid, str) and fcid != _d(prev_fmt.get("collection_pointer")).get("id")
                    and f"collection:{fcid}" not in self.created
                ):
                    c = await self.get("collection", fcid)
                    if not c or await self._collection_role(c) == "none":
                        return f"Database not found ({key})"
                for ptr in ("alias_pointer", "transclusion_reference_pointer"):
                    pid = _d(fmt.get(ptr)).get("id")
                    if (
                        isinstance(pid, str) and pid != _d(prev_fmt.get(ptr)).get("id")
                        and not await self._can_read_block(pid)
                    ):
                        return f"Linked block not found ({key})"
            if ch.table == "collection_view":
                cid = _d(fmt.get("collection_pointer")).get("id")
                if (
                    isinstance(cid, str) and cid != _d(prev_fmt.get("collection_pointer")).get("id")
                    and f"collection:{cid}" not in self.created
                ):
                    c = await self.get("collection", cid)
                    if not c or await self._collection_role(c) == "none":
                        return f"Database not found ({key})"
        return None

    async def _list_entry_problem(self, table: str, owner: dict, field: str, target: str, id_: str) -> str | None:
        rec = await self.get(target, id_)
        if not rec:
            return None if target == "block" and table == "space_view" else "Referenced record not found"
        match target:
            case "block":
                if table == "block" and rec.get("parent_table") == "block" and rec.get("parent_id") == owner.get("id"):
                    return None
                return None if await self._can_read_block(id_) else "Not allowed to reference this block"
            case "discussion" | "comment":
                return None if rec.get("parent_id") == owner.get("id") else "Not allowed to reference this record"
            case "collection_view":
                if f"collection_view:{id_}" in self.created or await self.role(rec.get("parent_id")) != "none":
                    return None
                return "Not allowed to reference this view"
            case "team":
                if rec.get("space_id") == owner.get("space_id") or (table == "space" and rec.get("space_id") == owner.get("id")):
                    space = await self.get("space", rec.get("space_id"))
                    return None if is_space_member(space, self.user_id) else "Not a member"
                return "Teamspace of another workspace"
            case _:
                return None
