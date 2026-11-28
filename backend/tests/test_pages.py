import pytest

from app.auth.users import create_user
from app.records.seed import create_page, save
from app.records.store import get_record, new_id, now_ms


async def call(client, name, body=None):
    return await client.post(f"/api/rpc/{name}", json=body or {})


async def sign_in(client, email, password="secret-123"):
    res = await call(client, "signInWithEmail", {"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["userId"]


@pytest.fixture
async def u1(db):
    return await create_user(db, "hong@example.com", "홍길동", "secret-123")


@pytest.fixture
async def u2(db):
    return await create_user(db, "kim@example.com", "김철수", "secret-123")


async def _workspace(client) -> tuple[str, str]:
    """로그인한 사용자로 워크스페이스를 만들고 (space id, 환영 페이지 id)를 돌려준다."""
    space_id = (await call(client, "createWorkspace", {"name": "영업팀"})).json()["spaceId"]
    rm = (await call(client, "loadAccountData")).json()["recordMap"]
    view = next(e["value"]["value"] for e in rm["space_view"].values())
    return space_id, view["private_pages"][0]


def _block(space_id, user_id, parent_id, type_, *, parent_table="block", **extra):
    now = now_ms()
    return {
        "id": new_id(), "type": type_, "properties": {}, "parent_id": parent_id, "parent_table": parent_table,
        "space_id": space_id, "alive": True, "created_time": now, "created_by_id": user_id,
        "created_by_table": "lit_user", "last_edited_time": now, "last_edited_by_id": user_id,
        "last_edited_by_table": "lit_user", **extra,
    }


async def _append_child(db, parent_id, child):
    """블록을 저장하고 부모의 content 끝에 붙인다."""
    await save(db, "block", child)
    parent = await get_record(db, "block", parent_id)
    await save(db, "block", {**parent, "content": [*(parent.get("content") or []), child["id"]]})
    await db.commit()
    return child


async def test_load_page_returns_subtree(client, db, u1):
    await sign_in(client, "hong@example.com")
    space_id, page_id = await _workspace(client)
    toggle = await _append_child(db, page_id, _block(space_id, u1.id, page_id, "toggle"))
    inner = await _append_child(db, toggle["id"], _block(space_id, u1.id, toggle["id"], "text"))

    res = await call(client, "loadPage", {"pageId": page_id})
    assert res.status_code == 200
    data = res.json()
    assert data["cursor"] == {"stack": []}
    rm = data["recordMap"]
    assert rm["__version__"] == 3
    page = rm["block"][page_id]["value"]
    assert page["role"] == "editor"
    # 환영 페이지 본문 7개 + 토글 1개
    assert len(page["value"]["content"]) == 8
    for bid in page["value"]["content"]:
        assert bid in rm["block"]
    assert inner["id"] in rm["block"]
    assert space_id in rm["space"]
    assert u1.id in rm["lit_user"]

    cached = (await call(client, "loadPageCached", {"page": {"id": page_id}})).json()
    assert cached["recordMap"]["block"].keys() == rm["block"].keys()


async def test_load_page_includes_database(client, db, u1):
    await sign_in(client, "hong@example.com")
    space_id, page_id = await _workspace(client)
    db_block = _block(space_id, u1.id, page_id, "collection_view")
    col = {
        "id": new_id(), "parent_id": db_block["id"], "parent_table": "block", "space_id": space_id, "alive": True,
        "schema": {"title": {"name": "이름", "type": "title"}},
    }
    view = {
        "id": new_id(), "type": "table", "parent_id": db_block["id"], "parent_table": "block",
        "space_id": space_id, "alive": True,
    }
    db_block.update(collection_id=col["id"], view_ids=[view["id"]])
    await save(db, "collection", col)
    await save(db, "collection_view", view)
    row = _block(space_id, u1.id, col["id"], "page", parent_table="collection", properties={"title": [["첫 행"]]})
    await save(db, "block", row)
    await _append_child(db, page_id, db_block)

    rm = (await call(client, "loadPage", {"pageId": page_id})).json()["recordMap"]
    assert db_block["id"] in rm["block"]
    assert col["id"] in rm["collection"]
    assert view["id"] in rm["collection_view"]
    assert row["id"] in rm["block"]


async def test_load_page_without_access_is_empty(client, u1, u2):
    await sign_in(client, "hong@example.com")
    _, page_id = await _workspace(client)
    await call(client, "signOut")
    await sign_in(client, "kim@example.com")
    res = await call(client, "loadPage", {"pageId": page_id})
    assert res.status_code == 200
    rm = res.json()["recordMap"]
    assert page_id not in rm.get("block", {})
    assert rm == {"__version__": 3}


async def test_fetch_records_filters_by_role(client, db, u1, u2):
    await sign_in(client, "hong@example.com")
    _, other_page = await _workspace(client)
    await call(client, "signOut")
    await sign_in(client, "kim@example.com")
    _, my_page = await _workspace(client)
    res = await call(client, "fetchRecords", {"requests": [
        {"pointer": {"table": "block", "id": my_page}, "version": -1},
        {"pointer": {"table": "block", "id": other_page}, "version": -1},
        {"pointer": {"table": "no_such_table", "id": my_page}},
        {"pointer": {"table": "block"}},
    ]})
    assert res.status_code == 200
    blocks = res.json()["recordMap"]["block"]
    assert list(blocks) == [my_page]


async def test_mark_visited_and_recent_pages(client, db, u1):
    await sign_in(client, "hong@example.com")
    space_id, page_id = await _workspace(client)
    for _ in range(2):
        res = await call(client, "markPageVisited", {"block": {"id": page_id, "spaceId": space_id}})
        assert res.status_code == 200 and res.json() == {}

    data = (await call(client, "listRecentPages", {"spaceId": space_id, "limit": 20})).json()
    assert [p["id"] for p in data["pages"]] == [page_id]
    assert isinstance(data["pages"][0]["visitedAt"], int)
    assert page_id in data["recordMap"]["block"]
    visit = await get_record(db, "page_visit", f"{u1.id}:{page_id}")
    assert visit["total_visits"] == 2 and visit["version"] == 2


async def test_mark_visited_needs_access(client, db, u1, u2):
    await sign_in(client, "hong@example.com")
    _, page_id = await _workspace(client)
    await call(client, "signOut")
    await sign_in(client, "kim@example.com")
    assert (await call(client, "markPageVisited", {"block": {"id": page_id}})).json() == {}
    assert await get_record(db, "page_visit", f"{u2.id}:{page_id}") is None


async def test_recent_pages_newest_first(client, db, u1):
    await sign_in(client, "hong@example.com")
    space_id, page_id = await _workspace(client)
    sub = await _append_child(db, page_id, _block(space_id, u1.id, page_id, "page"))
    await call(client, "markPageVisited", {"block": {"id": page_id}})
    await call(client, "markPageVisited", {"block": {"id": sub["id"]}})
    # 방문 시각을 직접 정해 순서를 확실하게 한다
    for pid, at in ((page_id, 1000), (sub["id"], 2000)):
        visit = await get_record(db, "page_visit", f"{u1.id}:{pid}")
        await save(db, "page_visit", {**visit, "visited_at": at})
    await db.commit()
    data = (await call(client, "listRecentPages", {"spaceId": space_id})).json()
    assert [p["id"] for p in data["pages"]] == [sub["id"], page_id]
    one = (await call(client, "listRecentPages", {"spaceId": space_id, "limit": 0})).json()
    # 0은 원본처럼 기본값 20이 된다
    assert len(one["pages"]) == 2


async def test_sidebar_children(client, db, u1):
    await sign_in(client, "hong@example.com")
    space_id, page_id = await _workspace(client)
    sub = await _append_child(db, page_id, _block(space_id, u1.id, page_id, "page", properties={"title": [["하위"]]}))
    grand = await _append_child(db, sub["id"], _block(space_id, u1.id, sub["id"], "page"))
    res = await call(client, "getSidebarChildren", {"blockIds": [page_id]})
    assert res.status_code == 200
    blocks = res.json()["recordMap"]["block"]
    assert page_id in blocks and sub["id"] in blocks and grand["id"] in blocks
    # 본문 블록(text, to_do 등)은 사이드바에 내려가지 않는다
    page = await get_record(db, "block", page_id)
    assert page["content"][0] not in blocks


async def test_shared_with_me(client, db, u1, u2):
    await sign_in(client, "hong@example.com")
    space_id, _ = await _workspace(client)
    shared = await create_page(
        db, space_id=space_id, user_id=u1.id, parent_id=space_id, parent_table="space", title="공유 문서",
        permissions=[
            {"type": "user_permission", "role": "editor", "user_id": u1.id},
            {"type": "user_permission", "role": "reader", "user_id": u2.id},
        ],
    )
    await db.commit()
    assert (await call(client, "getSharedWithMe", {"spaceId": space_id})).json()["pageIds"] == []
    await call(client, "signOut")
    await sign_in(client, "kim@example.com")
    data = (await call(client, "getSharedWithMe", {"spaceId": space_id})).json()
    assert data["pageIds"] == [shared["id"]]
    assert data["recordMap"]["block"][shared["id"]]["value"]["role"] == "reader"
    missing = (await call(client, "getSharedWithMe", {"spaceId": "없는-공간"})).json()
    assert missing == {"pageIds": [], "recordMap": {}}


async def test_changes_since(client, u1, u2):
    await sign_in(client, "hong@example.com")
    space_id, page_id = await _workspace(client)
    data = (await call(client, "getChangesSince", {"lsn": 0})).json()
    assert space_id in data["recordMap"]["space"] and page_id in data["recordMap"]["block"]
    assert data["lsn"] > 0
    again = (await call(client, "getChangesSince", {"lsn": data["lsn"], "spaceIds": [space_id]})).json()
    assert again == {"recordMap": {"__version__": 3}, "lsn": data["lsn"]}
    await call(client, "signOut")
    await sign_in(client, "kim@example.com")
    other = (await call(client, "getChangesSince", {"lsn": 0})).json()
    assert other == {"recordMap": {"__version__": 3}, "lsn": 0}


@pytest.mark.parametrize("name", ["getSidebarChildren", "getSharedWithMe", "markPageVisited", "listRecentPages", "getChangesSince"])
async def test_page_rpcs_require_login(client, name):
    assert (await call(client, name)).status_code == 401


# 화면이 시작할 때 부르지만 아직 기능이 없는 RPC: 원본 핸들러가 빈 워크스페이스에서 돌려주는 최상위 키
STUB_KEYS = {
    "countUnreadInbox": {"count"},
    "noteSessionDevice": {"isNew"},
    "listBacklinks": {"backlinks", "recordMap"},
    "recordPageView": {"recorded"},
    "getInbox": {"notificationIds", "items", "updates", "unreadCount", "recordMap"},
    "getAccounts": {"accounts", "recordMap"},
    "getMySessions": {"sessions"},
    "getAccountSecurity": {"hasPassword", "mfa", "emails", "maxEmails"},
    "getPasskeys": {"passkeys"},
    "searchWorkspace": {"results", "total", "recordMap"},
}


@pytest.mark.parametrize("name", sorted(STUB_KEYS))
async def test_stub(client, u1, name):
    await sign_in(client, "hong@example.com")
    space_id, page_id = await _workspace(client)
    res = await call(client, name, {"spaceId": space_id, "pageId": page_id, "block": {"id": page_id}, "query": "환영"})
    assert res.status_code == 200
    assert set(res.json()) == STUB_KEYS[name]


@pytest.mark.parametrize("name", sorted({*STUB_KEYS, "getTemplate"} - {"recordPageView"}))
async def test_stub_requires_login(client, name):
    assert (await call(client, name)).status_code == 401


async def test_stub_record_page_view_anonymous(client):
    res = await call(client, "recordPageView", {"pageId": "없는-페이지"})
    assert res.status_code == 200 and res.json() == {"recorded": False}


async def test_stub_get_template_not_found(client, u1):
    # 템플릿 갤러리가 없으므로 원본의 "없는 템플릿"과 같이 404를 돌려준다(온보딩은 실패를 무시한다)
    await sign_in(client, "hong@example.com")
    space_id, _ = await _workspace(client)
    res = await call(client, "getTemplate", {"templateId": "meeting-notes", "spaceId": space_id})
    assert res.status_code == 404
    # 등록되지 않은 RPC의 404("알 수 없는 요청입니다.")와 구별한다
    assert res.json()["message"] == "템플릿을 찾을 수 없습니다."


async def test_stub_get_accounts_lists_current(client, u1):
    await sign_in(client, "hong@example.com")
    space_id, _ = await _workspace(client)
    accounts = (await call(client, "getAccounts")).json()["accounts"]
    assert len(accounts) == 1
    a = accounts[0]
    assert a["userId"] == u1.id and a["email"] == "hong@example.com" and a["name"] == "홍길동" and a["current"] is True
    assert a["spaces"] == [{
        "id": space_id, "name": "영업팀", "icon": "", "domain": a["spaces"][0]["domain"], "plan": "plus", "memberCount": 1,
    }]


async def test_stub_account_security(client, u1):
    await sign_in(client, "hong@example.com")
    data = (await call(client, "getAccountSecurity")).json()
    assert data["hasPassword"] is True
    assert data["mfa"] == {"enabled": False, "factors": [], "backupCodesRemaining": 0, "maxAuthenticators": 2}
    assert data["emails"] == [{"email": "hong@example.com", "primary": True}]


async def test_ai_status_disabled(client, u1):
    await sign_in(client, "hong@example.com")
    space_id, _ = await _workspace(client)
    res = await call(client, "aiStatus", {"spaceId": space_id})
    assert res.status_code == 200
    body = res.json()
    # 원본 aiStatus 핸들러가 돌려주는 최상위 키
    assert set(body) == {"configured", "model", "modelLabel", "message", "skills", "languages", "tones", "models", "autoModel", "policy", "prefs", "limits"}
    assert body["configured"] is False
    assert body["policy"]["enabled"] is False
    assert body["models"] == [] and body["skills"] == []


async def test_ai_status_requires_login(client):
    assert (await call(client, "aiStatus")).status_code == 401
