"""레코드 기반 RPC: 계정 데이터, 워크스페이스 만들기, 페이지 읽기, 사이드바, 화면 시작용 임시 응답.
(원본 apps/server/src/api/handlers.ts, api/modules/sidebar.ts)"""
import math
from typing import Any

from sqlalchemy import BigInteger, cast, select

from app.auth.models import User
from app.records.pages import PAGE_TYPES, add_ancestors, add_outline_block, page_chunk, sidebar_children
from app.records.permissions import Lookup, effective_role, is_space_member
from app.records.recordmap import RecordMapBuilder
from app.records.seed import create_workspace, ensure_user_records, save
from app.records.store import TABLES, changes, current_lsn, get_record, now_ms, records, records_in_space
from app.rpc.errors import NotFoundError, UnauthorizedError
from app.rpc.registry import RpcContext, rpc

DEFAULT_WORKSPACE_NAME = "내 워크스페이스"
MAX_TREE_NODES = 3000
TREE_TYPES = ("page", "collection_view_page")


def _require_user(ctx: RpcContext) -> str:
    if not ctx.user_id:
        raise UnauthorizedError("로그인이 필요합니다.")
    return ctx.user_id


def _number(value: Any) -> float | None:
    """원본의 Number(value)처럼 숫자로 읽는다. 숫자가 아니면 None."""
    if isinstance(value, bool):
        return float(value)
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


async def _login_user(ctx: RpcContext) -> User:
    user = await ctx.db.get(User, ctx.user_id) if ctx.user_id else None
    if user is None:
        raise UnauthorizedError("로그인이 필요합니다.")
    return user


async def _user_spaces(lookup: Lookup, user_id: str) -> tuple[list[dict], list[dict]]:
    """본인의 space_view들과, 그중 멤버로 남아 있는 공간들."""
    root = await lookup.get("user_root", user_id)
    views: list[dict] = []
    for sv_id in (root or {}).get("space_views") or []:
        sv = await lookup.get("space_view", sv_id)
        # user_root.space_views는 사용자가 쓸 수 있으므로 본인 것만 인정한다
        if sv and sv.get("alive") is not False and sv.get("parent_id") == user_id:
            views.append(sv)
    spaces = []
    for sv in views:
        space = await lookup.space(sv.get("space_id"))
        if space and is_space_member(space, user_id):
            spaces.append(space)
    ids = {s["id"] for s in spaces}
    return [v for v in views if v.get("space_id") in ids], spaces


async def _add_page_trees(lookup: Lookup, rm: RecordMapBuilder, roots: list[str], user_id: str) -> None:
    """사이드바용 하위 페이지 트리(본문 블록은 빼고 page·collection_view_page만 내려간다)."""
    queue = list(roots)
    seen: set[str] = set()
    i = 0
    while i < len(queue) and len(seen) < MAX_TREE_NODES:
        bid = queue[i]
        i += 1
        if bid in seen:
            continue
        seen.add(bid)
        b = await lookup.block(bid)
        if not b or not b.get("alive"):
            continue
        role = await effective_role(lookup, bid, user_id)
        if role == "none":
            continue
        await rm.add("block", b, role)
        if b.get("type") in ("collection_view_page", "collection_view"):
            if b.get("collection_id"):
                await rm.add("collection", await lookup.collection(b["collection_id"]))
            for vid in b.get("view_ids") or []:
                await rm.add("collection_view", await lookup.get("collection_view", vid))
            continue
        for cid in b.get("content") or []:
            child = await lookup.block(cid)
            if child and child.get("type") in (*TREE_TYPES, "collection_view"):
                queue.append(cid)


async def _account_data(ctx: RpcContext, user_id: str) -> dict[str, Any]:
    lookup = Lookup(ctx.db)
    rm = RecordMapBuilder(lookup, user_id)
    for table in ("lit_user", "user_root", "user_settings"):
        await rm.add(table, await lookup.get(table, user_id), "editor")
    views, spaces = await _user_spaces(lookup, user_id)
    for v in views:
        await rm.add("space_view", v, "editor")
    for s in spaces:
        await rm.add("space", s)
        for p in s.get("permissions") or []:
            member_id = p.get("user_id") if isinstance(p, dict) else None
            if member_id and not rm.has("lit_user", member_id):
                await rm.add("lit_user", await lookup.get("lit_user", member_id), "reader")
        teams = [t for t in await records_in_space(ctx.db, "team", s["id"]) if t.get("alive") is not False]
        for t in teams:
            await rm.add("team", t)
        view = next((v for v in views if v.get("space_id") == s["id"]), None) or {}
        joined = view.get("joined_teams") or []
        roots = [
            *(view.get("private_pages") or []), *(view.get("bookmarked_pages") or []), *(s.get("pages") or []),
            *[pid for t in teams if t["id"] in joined for pid in t.get("team_pages") or []],
        ]
        await _add_page_trees(lookup, rm, roots, user_id)
    return {"recordMap": rm.map, "lsn": await current_lsn(ctx.db), "demoMode": {"enabled": False}}


@rpc("loadAccountData")
async def load_account_data(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    user = await _login_user(ctx)
    await ensure_user_records(ctx.db, user)
    await ctx.db.commit()
    return await _account_data(ctx, user.id)


@rpc("createWorkspace")
async def create_workspace_rpc(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    user = await _login_user(ctx)
    name = body.get("name")
    name = name.strip() if isinstance(name, str) else ""
    icon = body.get("icon")
    await ensure_user_records(ctx.db, user)
    space = await create_workspace(ctx.db, user.id, name or DEFAULT_WORKSPACE_NAME, icon if isinstance(icon, str) else None)
    await ctx.db.commit()
    return {"spaceId": space["id"], "recordMap": {"__version__": 3}}


# ---------- 페이지 읽기 ----------

@rpc("loadPage")
async def load_page(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    lookup = Lookup(ctx.db)
    rm = RecordMapBuilder(lookup, ctx.user_id)
    page_id = body.get("pageId")
    if isinstance(page_id, str) and page_id:
        await page_chunk(lookup, rm, page_id, ctx.user_id)
    return {"recordMap": rm.map, "cursor": {"stack": []}}


@rpc("loadPageCached")
async def load_page_cached(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    page = body.get("page")
    page_id = page.get("id") if isinstance(page, dict) and page.get("id") is not None else body.get("pageId")
    return await load_page(ctx, {"pageId": page_id})


@rpc("fetchRecords")
async def fetch_records(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    lookup = Lookup(ctx.db)
    rm = RecordMapBuilder(lookup, ctx.user_id)
    requests = body.get("requests")
    for r in (requests if isinstance(requests, list) else [])[:2000]:
        pointer = r.get("pointer") if isinstance(r, dict) else None
        table = pointer.get("table") if isinstance(pointer, dict) else None
        rid = pointer.get("id") if isinstance(pointer, dict) else None
        if table not in TABLES or not isinstance(rid, str):
            continue
        # 권한 없는 레코드는 RecordMapBuilder가 뺀다
        await rm.add(table, await lookup.get(table, rid))
    return {"recordMap": rm.map}


@rpc("getChangesSince")
async def get_changes_since(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    """재접속 복구용: lsn 뒤에 바뀐, 내가 멤버인 공간의 레코드들."""
    uid = _require_user(ctx)
    since = int(_number(body.get("lsn")) or 0)
    wanted = body.get("spaceIds")
    lookup = Lookup(ctx.db)
    _, spaces = await _user_spaces(lookup, uid)
    allowed = [s["id"] for s in spaces if not isinstance(wanted, list) or s["id"] in wanted]
    rows = []
    if allowed:
        res = await ctx.db.execute(
            select(changes.c.lsn, changes.c.tbl, changes.c.id)
            .where(changes.c.lsn > since, changes.c.space_id.in_(allowed))
            .order_by(changes.c.lsn)
            .limit(5000)
        )
        rows = list(res)
    rm = RecordMapBuilder(lookup, uid)
    for row in rows:
        await rm.add(row.tbl, await lookup.get(row.tbl, row.id))
    return {"recordMap": rm.map, "lsn": rows[-1].lsn if rows else since}


# ---------- 방문 기록 ----------

@rpc("markPageVisited")
async def mark_page_visited(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    uid = _require_user(ctx)
    block = body.get("block")
    page_id = block.get("id") if isinstance(block, dict) else None
    lookup = Lookup(ctx.db)
    page = await lookup.block(page_id)
    if not page or await effective_role(lookup, page["id"], uid) == "none":
        return {}
    visit_id = f"{uid}:{page['id']}"
    prev = await get_record(ctx.db, "page_visit", visit_id)
    await save(ctx.db, "page_visit", {
        "id": visit_id, "parent_id": page["id"], "parent_table": "block", "user_id": uid,
        "space_id": page.get("space_id"), "visited_at": now_ms(),
        "total_visits": ((prev or {}).get("total_visits") or 0) + 1,
    })
    await ctx.db.commit()
    return {}


@rpc("listRecentPages")
async def list_recent_pages(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    uid = _require_user(ctx)
    space_id = body.get("spaceId")
    limit = min(max(int(_number(body.get("limit")) or 20), 1), 200)
    visited_at = cast(records.c.data["visited_at"].astext, BigInteger)
    res = await ctx.db.execute(
        select(records.c.data)
        .where(
            records.c.tbl == "page_visit",
            records.c.space_id == (space_id if isinstance(space_id, str) else ""),
            records.c.data["user_id"].astext == uid,
        )
        .order_by(visited_at.desc().nulls_last())
        .limit(limit)
    )
    lookup = Lookup(ctx.db)
    rm = RecordMapBuilder(lookup, uid)
    pages: list[dict[str, Any]] = []
    for visit in res.scalars():
        page = await lookup.block(visit.get("parent_id"))
        if not page or not page.get("alive") or await effective_role(lookup, page["id"], uid) == "none":
            continue
        await rm.add("block", page)
        await add_ancestors(lookup, rm, page)
        pages.append({"id": page["id"], "visitedAt": visit.get("visited_at")})
    return {"pages": pages, "recordMap": rm.map}


# ---------- 사이드바 (원본 api/modules/sidebar.ts) ----------

@rpc("getSidebarChildren")
async def get_sidebar_children(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    uid = _require_user(ctx)
    block_ids = body.get("blockIds")
    ids = [str(b) for b in block_ids[:100]] if isinstance(block_ids, list) else []
    lookup = Lookup(ctx.db)
    rm = RecordMapBuilder(lookup, uid)
    await sidebar_children(lookup, rm, ids, uid)
    return {"recordMap": rm.map}


@rpc("getSharedWithMe")
async def get_shared_with_me(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    """다른 사람이 나에게 직접 공유한(user_permission) 맨 위 페이지 중 내 사이드바 목록에 없는 것."""
    uid = _require_user(ctx)
    lookup = Lookup(ctx.db)
    space = await lookup.space(str(body.get("spaceId")))
    if not space:
        return {"pageIds": [], "recordMap": {}}
    views, _ = await _user_spaces(lookup, uid)
    view = next((v for v in views if v.get("space_id") == space["id"]), None) or {}
    mine = {*(view.get("private_pages") or []), *(space.get("pages") or [])}
    res = await ctx.db.execute(
        select(records.c.data)
        .where(
            records.c.tbl == "block",
            records.c.space_id == space["id"],
            records.c.alive.is_(True),
            records.c.parent_table.in_(("space", "block")),
            records.c.data["permissions"].contains([{"type": "user_permission", "user_id": uid}]),
        )
        .order_by(records.c.last_edited_time.desc())
        .limit(200)
    )
    rm = RecordMapBuilder(lookup, uid)
    page_ids: list[str] = []
    for b in res.scalars():
        if b.get("type") not in PAGE_TYPES:
            continue
        if b["id"] in mine or b.get("created_by_id") == uid:
            continue
        # 공유받은 페이지 중 가장 위의 것만 사이드바에 나온다
        if b.get("parent_table") == "block":
            parent = await lookup.block(b.get("parent_id"))
            if parent and await effective_role(lookup, parent["id"], uid) != "none":
                continue
        if await effective_role(lookup, b["id"], uid) == "none":
            continue
        await add_outline_block(lookup, rm, b)
        page_ids.append(b["id"])
    return {"pageIds": page_ids, "recordMap": rm.map}


# ---------- 화면 시작 시 부르지만 아직 기능이 없는 RPC ----------
# 원본 핸들러가 데이터가 하나도 없는 워크스페이스에서 돌려주는 것과 같은 모양의 빈 응답을 돌려준다.
# 기능을 만들 때 이 임시 처리를 실제 구현으로 바꾼다.

@rpc("getTemplate")
async def get_template(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    # 템플릿 갤러리가 아직 없으므로 원본의 "없는 템플릿"(404)과 같다. 온보딩은 이 실패를 무시한다.
    _require_user(ctx)
    raise NotFoundError("템플릿을 찾을 수 없습니다.")


@rpc("countUnreadInbox")
async def count_unread_inbox(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    _require_user(ctx)
    return {"count": 0}


@rpc("getInbox")
async def get_inbox(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    _require_user(ctx)
    return {"notificationIds": [], "items": [], "updates": [], "unreadCount": 0, "recordMap": {"__version__": 3}}


@rpc("noteSessionDevice")
async def note_session_device(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    _require_user(ctx)
    return {"isNew": False}


@rpc("listBacklinks")
async def list_backlinks(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    _require_user(ctx)
    return {"backlinks": [], "recordMap": {"__version__": 3}}


@rpc("recordPageView")
async def record_page_view(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    # 원본도 로그인 없이 부를 수 있다(공개 페이지 방문). 페이지 분석은 아직 없다.
    return {"recorded": False}


@rpc("getAccounts")
async def get_accounts(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    """여러 계정 전환은 아직 없으므로 지금 로그인한 계정 하나만 돌려준다."""
    uid = _require_user(ctx)
    lookup = Lookup(ctx.db)
    user = await lookup.get("lit_user", uid) or {}
    _, spaces = await _user_spaces(lookup, uid)
    return {
        "accounts": [{
            "userId": uid, "name": user.get("name") or "", "email": user.get("email") or "",
            "photo": user.get("profile_photo") or "", "current": True,
            "spaces": [
                {
                    "id": s["id"], "name": s.get("name"), "icon": s.get("icon") or "", "domain": s.get("domain"),
                    "plan": s.get("plan_type"),
                    "memberCount": sum(
                        1 for p in s.get("permissions") or []
                        if isinstance(p, dict) and p.get("type") == "user_permission" and p.get("role") != "none"
                    ),
                }
                for s in spaces
            ],
        }],
        "recordMap": {"__version__": 3},
    }


@rpc("getMySessions")
async def get_my_sessions(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    _require_user(ctx)
    return {"sessions": []}


@rpc("getAccountSecurity")
async def get_account_security(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    user = await _login_user(ctx)
    return {
        "hasPassword": bool(user.password_hash),
        # 2단계 인증과 보조 이메일은 아직 없다(원본 상한값: 인증 앱 2개, 이메일 5개)
        "mfa": {"enabled": False, "factors": [], "backupCodesRemaining": 0, "maxAuthenticators": 2},
        "emails": [{"email": user.email.lower(), "primary": True}],
        "maxEmails": 5,
    }


@rpc("getPasskeys")
async def get_passkeys(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    _require_user(ctx)
    return {"passkeys": []}


@rpc("searchWorkspace")
async def search_workspace(ctx: RpcContext, body: dict[str, Any]) -> dict[str, Any]:
    # 실제 검색은 다음 계획에서 만든다
    _require_user(ctx)
    return {"results": [], "total": 0, "recordMap": {"__version__": 3}}
