"""페이지 트리 모으기: 원본 apps/server/src/api/handlers.ts의 pageChunk·addCollection·addAncestors,
tree.ts의 childBlocks, api/modules/sidebar.ts의 사이드바 헬퍼를 옮긴 것.

레코드를 레코드 맵에 넣을지는 RecordMapBuilder.add가 권한으로 정한다(볼 수 없는 레코드는 빠진다).
"""
from collections import deque
from collections.abc import Iterator
from typing import Any

from app.records.permissions import Lookup, effective_role, record_role
from app.records.recordmap import RecordMapBuilder
from app.records.store import children_of

PAGE_TYPES = ("page", "collection_view_page")
DATABASE_TYPES = ("collection_view", "collection_view_page")
# 사이드바 트리에 나오는 블록
OUTLINE_TYPES = ("page", "collection_view_page", "collection_view")


def _ids(value: Any) -> list[str]:
    """ID 목록 필드(content, view_ids 등)에서 문자열만 고른다(클라이언트가 쓸 수 있는 값이라 모양을 믿지 않는다)."""
    return [v for v in value if isinstance(v, str) and v] if isinstance(value, list) else []


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _pointer_id(block: dict, key: str) -> str | None:
    """format.<key>.id (alias_pointer, transclusion_reference_pointer 등)."""
    pid = _dict(_dict(block.get("format")).get(key)).get("id")
    return pid if isinstance(pid, str) else None


def _annotations(value: Any) -> Iterator[tuple[Any, str]]:
    """리치 텍스트 [[글자, [[종류, 값, ...], ...]], ...]에서 값이 문자열인 주석(p: 페이지 멘션, u: 사람 멘션)."""
    if not isinstance(value, list):
        return
    for d in value:
        if isinstance(d, list) and len(d) > 1 and isinstance(d[1], list):
            for a in d[1]:
                if isinstance(a, list) and len(a) > 1 and isinstance(a[1], str):
                    yield a[0], a[1]


async def child_blocks(lookup: Lookup, b: dict | None, *, alive_only: bool = True) -> list[dict]:
    """`b`의 진짜 자식들(content 순서). content는 클라이언트가 쓸 수 있으므로 부모를 되가리키는 블록만 인정한다."""
    if not b:
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for cid in _ids(b.get("content")):
        if cid in seen:
            continue
        seen.add(cid)
        c = await lookup.block(cid)
        if not c or c.get("parent_table") != "block" or c.get("parent_id") != b.get("id"):
            continue
        if alive_only and c.get("alive") is False:
            continue
        out.append(c)
    return out


async def add_ancestors(lookup: Lookup, rm: RecordMapBuilder, b: dict, limit: int = 30) -> None:
    """브레드크럼용 조상들: 부모 블록, 데이터베이스 행이면 collection과 그 블록, 팀 직속이면 팀."""
    cur: dict | None = b
    for _ in range(limit):
        if not cur:
            break
        parent_table = cur.get("parent_table")
        if parent_table == "block":
            cur = await lookup.block(cur.get("parent_id"))
            await rm.add("block", cur)
        elif parent_table == "collection":
            col = await lookup.collection(cur.get("parent_id"))
            if not col:
                break
            await rm.add("collection", col)
            cur = await lookup.block(col.get("parent_id"))
            await rm.add("block", cur)
        elif parent_table == "team":
            await rm.add("team", await lookup.team(cur.get("parent_id")))
            break
        else:
            break


async def _add_collection_records(
    lookup: Lookup, rm: RecordMapBuilder, col: dict | None, users: set[str], seen: set[str],
) -> None:
    """데이터 소스 하나: collection, 템플릿 페이지, 행, 관계 대상 데이터베이스와 그 행."""
    if not col or col["id"] in seen:
        return
    seen.add(col["id"])
    await rm.add("collection", col)
    for tid in _ids(col.get("template_pages")):
        await rm.add("block", await lookup.block(tid))
    schema = _dict(col.get("schema"))
    for row in await children_of(lookup.db, "block", col["id"]):
        if row.get("parent_table") != "collection" or not row.get("alive"):
            continue
        await rm.add("block", row)
        users.update((row.get("created_by_id"), row.get("last_edited_by_id")))
        for key, value in _dict(row.get("properties")).items():
            prop_type = _dict(schema.get(key)).get("type")
            for kind, target in _annotations(value):
                if prop_type == "person" and kind == "u":
                    users.add(target)
                elif prop_type == "relation" and kind == "p":
                    await rm.add("block", await lookup.block(target))
    # 관계 대상 데이터베이스(롤업·관계 제목 표시용)
    for prop in schema.values():
        target_id = _dict(prop).get("collection_id")
        if _dict(prop).get("type") != "relation" or not isinstance(target_id, str) or rm.has("collection", target_id):
            continue
        target = await lookup.collection(target_id)
        if target:
            await rm.add("collection", target)
            for row in await children_of(lookup.db, "block", target["id"]):
                if row.get("alive") and row.get("parent_table") == "collection":
                    await rm.add("block", row)


async def add_collection(lookup: Lookup, rm: RecordMapBuilder, b: dict, users: set[str]) -> None:
    """데이터베이스 블록이 보여 주는 모든 데이터 소스(블록의 collection, 보기들이 가리키는 소스)와 모든 보기."""
    views = [v for v in await children_of(lookup.db, "collection_view", b["id"]) if v.get("alive") is not False]
    source_ids: list[str] = []
    for sid in (b.get("collection_id"), *(_pointer_id(v, "collection_pointer") for v in views)):
        if isinstance(sid, str) and sid and sid not in source_ids:
            source_ids.append(sid)
    seen: set[str] = set()
    for cid in source_ids:
        await _add_collection_records(lookup, rm, await lookup.collection(cid), users, seen)
    for vid in _ids(b.get("view_ids")):
        await rm.add("collection_view", await lookup.get("collection_view", vid))
    for v in views:
        if not rm.has("collection_view", v["id"]):
            await rm.add("collection_view", v)


async def page_chunk(lookup: Lookup, rm: RecordMapBuilder, page_id: str, user_id: str | None) -> None:
    """페이지 하나를 그리는 데 필요한 것: 하위 블록(중첩 페이지 안으로는 내려가지 않음), 데이터베이스,
    멘션된 페이지, 댓글, 조상(브레드크럼), space, 작성자들. 읽을 수 없는 페이지면 아무것도 넣지 않는다."""
    root = await lookup.block(page_id)
    if not root or await record_role(lookup, "block", root, user_id) == "none":
        return
    queue: deque[dict] = deque([root])
    users: set[str] = set()
    seen: set[str] = set()
    while queue:
        b = queue.popleft()
        if b["id"] in seen:
            continue
        seen.add(b["id"])
        await rm.add("block", b)
        users.update((b.get("created_by_id"), b.get("last_edited_by_id")))
        btype = b.get("type")
        nested_page = b["id"] != page_id and btype in PAGE_TYPES
        if btype in DATABASE_TYPES:
            await add_collection(lookup, rm, b, users)
        if btype == "transclusion_reference":
            src = await lookup.block(_pointer_id(b, "transclusion_reference_pointer"))
            if src:
                queue.append(src)
        if btype in ("alias", "link_to_page"):
            await rm.add("block", await lookup.block(_pointer_id(b, "alias_pointer")))
        # 멘션된 페이지(본문 안에 제목·아이콘을 그린다)와 사람
        for value in _dict(b.get("properties")).values():
            for kind, target in _annotations(value):
                if kind == "p":
                    await rm.add("block", await lookup.block(target))
                elif kind == "u":
                    users.add(target)
        for did in _ids(b.get("discussions")):
            d = await lookup.get("discussion", did)
            if not d:
                continue
            await rm.add("discussion", d)
            for cid in _ids(d.get("comments")):
                c = await lookup.get("comment", cid)
                if c:
                    await rm.add("comment", c)
                    users.add(c.get("created_by_id"))
        if nested_page:
            continue
        queue.extend(await child_blocks(lookup, b, alive_only=False))
    await add_ancestors(lookup, rm, root, limit=50)
    await rm.add("space", await lookup.space(root.get("space_id")))
    for uid in users:
        if isinstance(uid, str) and uid:
            await rm.add("lit_user", await lookup.get("lit_user", uid), "reader")


async def _alias_target(lookup: Lookup, b: dict) -> dict | None:
    """"페이지 링크" 블록(alias)이 가리키는 살아 있는 페이지. 사이드바는 이것을 하위 페이지처럼 보여 준다."""
    if b.get("type") != "alias":
        return None
    t = await lookup.block(_pointer_id(b, "alias_pointer"))
    return t if t and t.get("alive") and t.get("type") in PAGE_TYPES else None


async def add_outline_block(lookup: Lookup, rm: RecordMapBuilder, b: dict) -> None:
    await rm.add("block", b)
    if b.get("type") in DATABASE_TYPES:
        if b.get("collection_id"):
            await rm.add("collection", await lookup.collection(b["collection_id"]))
        for vid in _ids(b.get("view_ids")):
            await rm.add("collection_view", await lookup.get("collection_view", vid))


async def sidebar_children(lookup: Lookup, rm: RecordMapBuilder, block_ids: list[str], user_id: str) -> None:
    """주어진 블록들의 바로 아래 페이지·데이터베이스를 두 단계까지(토글이 자식 유무를 알 수 있게) 넣는다."""
    for bid in block_ids:
        b = await lookup.block(bid)
        if not b or await effective_role(lookup, bid, user_id) == "none":
            continue
        await add_outline_block(lookup, rm, b)
        for cid in _ids(b.get("content")):
            c = await lookup.block(cid)
            if not c or not c.get("alive"):
                continue
            target = await _alias_target(lookup, c)
            if target:
                await rm.add("block", c)
                await add_outline_block(lookup, rm, target)
            elif c.get("type") in OUTLINE_TYPES:
                await add_outline_block(lookup, rm, c)
            else:
                continue
            page = target or c
            for gid in _ids(page.get("content")) if page.get("type") == "page" else []:
                g = await lookup.block(gid)
                if not g or not g.get("alive"):
                    continue
                gt = await _alias_target(lookup, g)
                if gt:
                    await rm.add("block", g)
                    await add_outline_block(lookup, rm, gt)
                elif g.get("type") in OUTLINE_TYPES:
                    await add_outline_block(lookup, rm, g)
