"""레코드 기반 RPC: loadAccountData, createWorkspace. (원본 apps/server/src/api/handlers.ts)"""
from typing import Any

from app.auth.models import User
from app.records.permissions import Lookup, effective_role, is_space_member
from app.records.recordmap import RecordMapBuilder
from app.records.seed import create_workspace, ensure_user_records
from app.records.store import current_lsn, records_in_space
from app.rpc.errors import UnauthorizedError
from app.rpc.registry import RpcContext, rpc

DEFAULT_WORKSPACE_NAME = "내 워크스페이스"
MAX_TREE_NODES = 3000
TREE_TYPES = ("page", "collection_view_page")


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
