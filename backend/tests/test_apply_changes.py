import json
import secrets
import uuid

import pytest

from app.auth.users import create_user
from app.records import apply as apply_module
from app.records.seed import save
from app.records.store import current_lsn, get_record, new_id, now_ms

_NO_ARGS = object()


async def call(client, name, body=None):
    return await client.post(f"/api/rpc/{name}", json=body or {})


async def as_user(client, email, password="secret-123"):
    """다른 사용자로 바꿔 로그인한다(테스트 클라이언트 하나를 같이 쓴다)."""
    await call(client, "signOut")
    res = await call(client, "signInWithEmail", {"email": email, "password": password})
    assert res.status_code == 200
    return res.json()["userId"]


def op(table, id, path, command, args=_NO_ARGS, space_id=None):
    o = {"pointer": {"table": table, "id": id, "spaceId": space_id}, "path": path, "command": command}
    if args is not _NO_ARGS:
        o["args"] = args
    return o


def tx(*ops, tx_id=None):
    return {"id": tx_id or str(uuid.uuid4()), "spaceId": "", "operations": list(ops)}


async def apply(client, *txs):
    # 브라우저처럼 짝 잃은 서로게이트·NaN도 보낼 수 있게 직접 직렬화한다(httpx의 json=은 거절한다)
    body = json.dumps({"requestId": str(uuid.uuid4()), "transactions": list(txs)})
    return await client.post("/api/rpc/applyChanges", content=body, headers={"content-type": "application/json"})


def title_of(rec):
    return "".join(part[0] for part in (rec.get("properties") or {}).get("title") or [])


@pytest.fixture
async def ws(client, db):
    """u1이 만든 워크스페이스. u2는 같은 공간 멤버(권한 목록에 직접 넣음), u3은 비멤버."""
    u1 = await create_user(db, "hong@example.com", "홍길동", "secret-123")
    u2 = await create_user(db, "kim@example.com", "김철수", "secret-123")
    u3 = await create_user(db, "lee@example.com", "이영희", "secret-123")
    ids = {"u1": u1.id, "u2": u2.id, "u3": u3.id}  # 롤백 뒤 ORM 객체를 건드리지 않도록 ID만 쓴다
    await as_user(client, "hong@example.com")
    space_id = (await call(client, "createWorkspace", {"name": "영업팀"})).json()["spaceId"]
    rm = (await call(client, "loadAccountData")).json()["recordMap"]
    view = next(e["value"]["value"] for e in rm["space_view"].values())
    team = next(e["value"]["value"] for e in rm["team"].values())
    space = await get_record(db, "space", space_id)
    space["permissions"].append({"type": "user_permission", "role": "editor", "user_id": ids["u2"]})
    await save(db, "space", space)
    await db.commit()
    team_home = await get_record(db, "block", team["team_pages"][0])
    return {
        **ids, "space": space_id, "welcome": view["private_pages"][0], "view": view["id"], "team": team["id"],
        "team_home": team_home["id"], "team_text": team_home["content"][0],
    }


async def _create_text_block(client, ws, parent_id, title="첫 줄"):
    bid = new_id()
    res = await apply(client, tx(
        op("block", bid, [], "set", {
            "id": bid, "type": "text", "properties": {"title": [[title]]}, "parent_id": parent_id,
            "parent_table": "block", "alive": True, "created_by_id": "someone-else",
        }, space_id=ws["space"]),
        op("block", parent_id, ["content"], "listAfter", {"id": bid}, space_id=ws["space"]),
    ))
    return bid, res


# ---------- 기본 편집 ----------

async def test_create_block_under_own_page(client, db, ws):
    bid, res = await _create_text_block(client, ws, ws["welcome"])
    assert res.status_code == 200, res.text
    rm = res.json()["recordMap"]
    assert bid in rm["block"] and ws["welcome"] in rm["block"]
    rec = await get_record(db, "block", bid)
    assert rec["version"] == 1
    assert rec["created_by_id"] == ws["u1"]
    assert rec["space_id"] == ws["space"]
    page = await get_record(db, "block", ws["welcome"])
    assert page["content"][-1] == bid
    assert len(page["applied_tx_ids"]) == 1


async def test_splice_title(client, db, ws):
    bid, _ = await _create_text_block(client, ws, ws["welcome"], "Hello")
    res = await apply(client, tx(op("block", bid, ["properties", "title"], "spliceText", {
        "base": "Hello", "start": 5, "end": 5, "insert": [[" world"]],
    })))
    assert res.status_code == 200, res.text
    rec = await get_record(db, "block", bid)
    assert title_of(rec) == "Hello world"
    assert rec["version"] == 2


async def test_apply_changes_concurrent_splices_merge(client, db, ws):
    block = await get_record(db, "block", ws["team_text"])
    await save(db, "block", {**block, "properties": {"title": [["Hello"]]}})
    await db.commit()
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "spliceText", {
        "base": "Hello", "start": 5, "end": 5, "insert": [["!"]],
    })))
    assert res.status_code == 200, res.text
    await as_user(client, "kim@example.com")
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "spliceText", {
        "base": "Hello", "start": 0, "end": 0, "insert": [[">"]],
    })))
    assert res.status_code == 200, res.text
    assert title_of(await get_record(db, "block", ws["team_text"])) == ">Hello!"


async def test_creates_child_of_block_created_in_same_call(client, db, ws):
    # 같은 호출에서 먼저 만든 토글 아래에 글 블록을 만든다(호출 안의 부모 상태로 권한을 본다)
    toggle, child = new_id(), new_id()
    res = await apply(client, tx(
        op("block", toggle, [], "set", {"type": "toggle", "parent_id": ws["welcome"], "parent_table": "block", "alive": True}),
        op("block", ws["welcome"], ["content"], "listAfter", {"id": toggle}),
        op("block", child, [], "set", {"type": "text", "parent_id": toggle, "parent_table": "block", "alive": True}),
        op("block", toggle, ["content"], "listAfter", {"id": child}),
    ))
    assert res.status_code == 200, res.text
    rec = await get_record(db, "block", child)
    assert rec["space_id"] == ws["space"] and rec["created_by_id"] == ws["u1"]


# ---------- 권한 ----------

async def test_cannot_edit_other_users_private_page(client, db, ws):
    await as_user(client, "kim@example.com")
    res = await apply(client, tx(op("block", ws["welcome"], ["properties", "title"], "set", [["바꿈"]])))
    assert res.status_code == 403
    assert res.json()["message"] == "이 작업을 할 권한이 없습니다."
    await as_user(client, "lee@example.com")
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "set", [["바꿈"]])))
    assert res.status_code == 403
    assert title_of(await get_record(db, "block", ws["welcome"])) != "바꿈"


async def test_rejected_call_saves_nothing(client, db, ws):
    lsn = await current_lsn(db)
    before = await get_record(db, "block", ws["team_text"])
    await as_user(client, "kim@example.com")
    res = await apply(client, tx(
        op("block", ws["team_text"], ["properties", "title"], "set", [["허용"]]),
        op("block", ws["welcome"], ["properties", "title"], "set", [["거절"]]),
    ))
    assert res.status_code == 403
    assert await get_record(db, "block", ws["team_text"]) == before
    assert await current_lsn(db) == lsn


async def test_retry_is_idempotent(client, db, ws):
    t = tx(op("block", ws["team_text"], ["properties", "title"], "set", [["한 번"]]))
    first = await apply(client, t)
    assert first.status_code == 200
    version = (await get_record(db, "block", ws["team_text"]))["version"]
    second = await apply(client, t)
    assert second.status_code == 200
    assert ws["team_text"] in second.json()["recordMap"]["block"]
    assert (await get_record(db, "block", ws["team_text"]))["version"] == version


async def test_server_owned_fields_ignored(client, db, ws):
    bid = new_id()
    res = await apply(client, tx(
        op("block", bid, [], "set", {"type": "text", "parent_id": ws["welcome"], "parent_table": "block",
                                     "alive": True, "version": 99, "applied_tx_ids": ["x"]}),
        op("block", ws["welcome"], ["content"], "listAfter", {"id": bid}),
    ))
    assert res.status_code == 200, res.text
    rec = await get_record(db, "block", bid)
    assert rec["version"] == 1 and rec["applied_tx_ids"] != ["x"]
    res = await apply(client, tx(op("block", bid, ["version"], "set", 99)))
    assert res.status_code == 400
    assert res.json()["message"] == "잘못된 요청입니다."


async def test_cannot_create_space_or_touch_others_sidebar(client, ws):
    sid = new_id()
    res = await apply(client, tx(op("space", sid, [], "set", {"name": "몰래", "permissions": []})))
    assert res.status_code == 403
    await as_user(client, "kim@example.com")
    res = await apply(client, tx(op("space_view", ws["view"], ["private_pages"], "listAfter", {"id": ws["team_home"]})))
    assert res.status_code == 403


async def test_cannot_move_block_to_other_workspace(client, db, ws):
    other_space = (await call(client, "createWorkspace", {"name": "다른 곳"})).json()["spaceId"]
    rm =(await call(client, "loadAccountData")).json()["recordMap"]
    view = next(e["value"]["value"] for e in rm["space_view"].values() if e["value"]["value"]["space_id"] == other_space)
    other_page = view["private_pages"][0]
    block_id = (await get_record(db, "block", ws["welcome"]))["content"][0]
    res = await apply(client, tx(
        op("block", ws["welcome"], ["content"], "listRemove", {"id": block_id}),
        op("block", block_id, [], "update", {"parent_id": other_page}),
        op("block", other_page, ["content"], "listAfter", {"id": block_id}),
    ))
    assert res.status_code == 403


async def test_orphan_block_rejected(client, ws):
    bid = new_id()
    res = await apply(client, tx(op("block", bid, [], "set", {
        "type": "text", "parent_id": new_id(), "parent_table": "block", "alive": True,
    })))
    assert res.status_code == 403


async def test_cannot_adopt_unreadable_block(client, ws):
    # u2가 읽을 수 없는 u1의 비공개 페이지를 팀 홈 content에 끼워 넣지 못한다
    await as_user(client, "kim@example.com")
    res = await apply(client, tx(op("block", ws["team_home"], ["content"], "listAfter", {"id": ws["welcome"]})))
    assert res.status_code == 403


async def test_space_settings_owner_only(client, db, ws):
    await as_user(client, "kim@example.com")
    res = await apply(client, tx(op("space", ws["space"], ["name"], "set", "새 이름")))
    assert res.status_code == 403
    res = await apply(client, tx(op("space", ws["space"], ["permissions"], "set", [])))
    assert res.status_code == 403
    # 멤버는 공간 직속 페이지 목록(pages)은 바꿀 수 있다
    pid = new_id()
    res = await apply(client, tx(
        op("block", pid, [], "set", {"type": "page", "parent_id": ws["space"], "parent_table": "space", "alive": True}),
        op("space", ws["space"], ["pages"], "listAfter", {"id": pid}),
    ))
    assert res.status_code == 200, res.text
    await as_user(client, "hong@example.com")
    res = await apply(client, tx(op("space", ws["space"], ["name"], "set", "새 이름")))
    assert res.status_code == 200
    res = await apply(client, tx(op("space", ws["space"], ["plan_type"], "set", "enterprise")))
    assert res.status_code == 403


async def test_team_settings_owner_only(client, db, ws):
    owners = (await get_record(db, "team", ws["team"]))["membership"]
    await as_user(client, "kim@example.com")
    res = await apply(client, tx(op("team", ws["team"], ["name"], "set", "바꿈")))
    assert res.status_code == 403
    # 열린 팀에는 스스로 들어갈 수 있다
    me = {"user_id": ws["u2"], "role": "member"}
    res = await apply(client, tx(op("team", ws["team"], ["membership"], "set", [*owners, me])))
    assert res.status_code == 200, res.text
    # 팀 소유자를 내보낼 수는 없다
    res = await apply(client, tx(op("team", ws["team"], ["membership"], "set", [me])))
    assert res.status_code == 403


async def test_lit_user_email_cannot_change(client, ws):
    res = await apply(client, tx(op("lit_user", ws["u1"], ["email"], "set", "evil@example.com")))
    assert res.status_code == 403
    res = await apply(client, tx(op("lit_user", ws["u1"], ["name"], "set", "길동")))
    assert res.status_code == 200
    res = await apply(client, tx(op("lit_user", ws["u2"], ["name"], "set", "남의 이름")))
    assert res.status_code == 403


# ---------- 모양 검사 ----------

@pytest.mark.parametrize("bad", [
    {"pointer": {"table": "nope", "id": "x"}, "path": [], "command": "set", "args": {}},
    {"pointer": {"table": "block", "id": "x"}, "path": [], "command": "explode", "args": {}},
    {"pointer": {"table": "block", "id": "x"}, "path": ["__proto__", "a"], "command": "set", "args": 1},
    {"pointer": {"table": "block", "id": "x"}, "path": ["format"], "command": "spliceText",
     "args": {"base": "", "start": 0, "end": 0, "insert": []}},
    {"pointer": {"table": "block", "id": "x"}, "command": "set", "args": 1},
    {"pointer": {"table": "block", "id": "x" * 201}, "path": [], "command": "set", "args": {}},
    {"pointer": {"table": "block", "id": "x"}, "path": ["a"] * 17, "command": "set", "args": 1},
    {"pointer": {"table": "block", "id": "x"}, "path": ["a" * 257], "command": "set", "args": 1},
    {"pointer": {"table": "block", "id": "x"}, "path": [], "command": "update", "args": {"a": {"constructor": 1}}},
    {"pointer": {"table": "block", "id": "x"}, "path": ["content"], "command": "listAfter", "args": {"id": 5}},
])
async def test_invalid_shapes_400(client, ws, bad):
    res = await apply(client, tx(bad))
    assert res.status_code == 400
    assert res.json()["message"] == "잘못된 요청입니다."


@pytest.mark.parametrize("args", [
    {"base": "", "end": 0, "insert": []},
    {"base": "", "start": "0", "end": 0, "insert": []},
    {"base": "", "start": True, "end": 1, "insert": []},
    {"base": "", "start": 2, "end": 1, "insert": []},
    {"base": "", "start": 0, "end": 0, "insert": [[]]},
    {"base": "", "start": 0, "end": 0, "insert": [[5]]},
    {"base": "", "start": 0, "end": 0, "insert": [["a", [[]]]]},
    {"base": 1, "start": 0, "end": 0, "insert": []},
])
async def test_malformed_splice_args_400(client, ws, args):
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "spliceText", args)))
    assert res.status_code == 400


async def test_splice_on_malformed_stored_text_400(client, ws):
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "set", [[]])))
    assert res.status_code == 200
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "spliceText", {
        "base": "", "start": 0, "end": 0, "insert": [["a"]],
    })))
    assert res.status_code == 400


async def test_splice_cutting_emoji_in_half_400(client, db, ws):
    # "a😀b"에서 이모지 한가운데(UTF-16 위치 2)에 글자를 넣으면 짝 잃은 서로게이트가 생긴다: 저장할 수 없으므로 400
    block = await get_record(db, "block", ws["team_text"])
    await save(db, "block", {**block, "properties": {"title": [["a😀b"]]}})
    await db.commit()
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "spliceText", {
        "base": "a😀b", "start": 2, "end": 2, "insert": [["x"]],
    })))
    assert res.status_code == 400
    assert title_of(await get_record(db, "block", ws["team_text"])) == "a😀b"
    # 이모지 앞뒤는 그대로 된다
    res = await apply(client, tx(op("block", ws["team_text"], ["properties", "title"], "spliceText", {
        "base": "a😀b", "start": 3, "end": 3, "insert": [["x"]],
    })))
    assert res.status_code == 200
    assert title_of(await get_record(db, "block", ws["team_text"])) == "a😀xb"


@pytest.mark.parametrize("path,value", [
    (["properties", "title"], [["nul\u0000"]]),
    (["properties", "title"], [["\ud83d"]]),
    (["alive"], "yes"),
    (["last_edited_time"], "어제"),
    (["last_edited_time"], float("nan")),
])
async def test_unstorable_values_400(client, ws, path, value):
    res = await apply(client, tx(op("block", ws["team_text"], path, "set", value)))
    assert res.status_code == 400


async def test_non_string_index_columns_rejected(client, ws):
    # 블록의 parent_id를 이상한 값으로 바꾸면 옮기기 검사에서 부모를 못 찾아 403(500이 아니다)
    res = await apply(client, tx(op("block", ws["team_text"], ["parent_id"], "set", {"x": 1})))
    assert res.status_code == 403
    # 부모 검사가 없는 레코드는 저장 직전 모양 검사에서 400
    vid = f"{ws['u1']}:{ws['welcome']}"
    res = await apply(client, tx(op("page_visit", vid, [], "set", {"user_id": ws["u1"], "parent_id": {"x": 1}})))
    assert res.status_code == 400
    res = await apply(client, tx(op("page_visit", vid, [], "set", {"user_id": ws["u1"], "space_id": 5})))
    assert res.status_code == 400


async def test_page_visit_numbers_must_be_integers(client, ws):
    vid = f"{ws['u1']}:{ws['welcome']}"
    base = {"user_id": ws["u1"], "parent_id": ws["welcome"], "parent_table": "block", "space_id": ws["space"]}
    res = await apply(client, tx(op("page_visit", vid, [], "set", {**base, "visited_at": "어제"})))
    assert res.status_code == 400
    res = await apply(client, tx(op("page_visit", vid, [], "set", {**base, "visited_at": 1.5, "total_visits": 1})))
    assert res.status_code == 400
    res = await apply(client, tx(op("page_visit", vid, [], "set", {**base, "visited_at": 10, "total_visits": "2"})))
    assert res.status_code == 400
    res = await apply(client, tx(op("page_visit", vid, [], "set", {**base, "visited_at": 10, "total_visits": 2})))
    assert res.status_code == 200
    res = await call(client, "listRecentPages", {"spaceId": ws["space"]})
    assert res.status_code == 200
    # 남의 방문 기록은 만들 수 없다
    res = await apply(client, tx(op("page_visit", f"{ws['u2']}:x", [], "set", {**base, "user_id": ws["u2"], "visited_at": 1})))
    assert res.status_code == 403


async def test_too_many_transactions_or_operations(client, ws):
    res = await call(client, "applyChanges", {"transactions": [tx() for _ in range(501)]})
    assert res.status_code == 400
    ops = [op("block", ws["team_text"], ["alive"], "set", True)] * 20001
    res = await call(client, "applyChanges", {"transactions": [tx(*ops)]})
    assert res.status_code == 413


async def test_anonymous_401(client):
    res = await apply(client, tx())
    assert res.status_code == 401


# ---------- 커밋 뒤 훅 ----------

async def test_on_commit_hooks(client, ws, monkeypatch):
    seen = []

    async def ok(changes, origin):
        seen.append(([c.record["id"] for c in changes], origin))

    async def broken(changes, origin):
        raise RuntimeError("훅 실패")

    monkeypatch.setattr(apply_module, "_commit_hooks", [])
    apply_module.on_commit(broken)
    apply_module.on_commit(ok)
    res = await client.post(
        "/api/rpc/applyChanges",
        json={"transactions": [tx(op("block", ws["team_text"], ["alive"], "set", True))]},
        headers={"x-lit-client-id": "client-1"},
    )
    assert res.status_code == 200
    assert seen == [([ws["team_text"]], "client-1")]
    # 거절된 호출은 훅을 부르지 않는다
    res = await apply(client, tx(op("space", new_id(), [], "set", {})))
    assert res.status_code == 403
    assert len(seen) == 1


async def test_old_applied_tx_pruned(client, db, ws, monkeypatch):
    from sqlalchemy import insert, select

    from app.records.store import applied_tx

    await db.execute(insert(applied_tx).values(id="old-tx", at=now_ms() - 3 * 86400_000))
    await db.commit()
    monkeypatch.setattr(apply_module, "_last_prune", 0)
    res = await apply(client, tx(op("block", ws["team_text"], ["alive"], "set", True), tx_id="new-tx"))
    assert res.status_code == 200
    ids = set((await db.execute(select(applied_tx.c.id))).scalars())
    assert ids == {"new-tx"}


@pytest.mark.parametrize("tx_id", ["x" * 101, "\ud83d", 5])
async def test_invalid_transaction_id_400(client, ws, tx_id):
    t = tx(op("block", ws["team_text"], ["alive"], "set", True))
    t["id"] = tx_id
    res = await apply(client, t)
    assert res.status_code == 400


# ---------- 같은 호출 안에서 만든 레코드를 뒤 연산으로 바꾸기 ----------

async def test_created_records_keep_server_authorship(client, db, ws):
    # u2가 토론·댓글·블록을 만들고 같은 호출에서 작성자를 u1로 바꿔도 저장되는 작성자는 u2다
    await as_user(client, "kim@example.com")
    did, cid, bid = new_id(), new_id(), new_id()
    res = await apply(client, tx(
        op("discussion", did, [], "set", {"parent_id": ws["team_text"], "parent_table": "block", "comments": [cid]}),
        op("comment", cid, [], "set", {"parent_id": did, "parent_table": "discussion", "text": [["안녕"]], "alive": True}),
        op("block", ws["team_text"], ["discussions"], "listAfter", {"id": did}),
        op("block", bid, [], "set", {"type": "text", "parent_id": ws["team_home"], "parent_table": "block", "alive": True}),
        op("block", ws["team_home"], ["content"], "listAfter", {"id": bid}),
        op("discussion", did, ["created_by_id"], "set", ws["u1"]),
        op("comment", cid, ["created_by_id"], "set", ws["u1"]),
        op("block", bid, [], "update", {"created_by_id": ws["u1"], "created_by_table": "bot"}),
    ))
    assert res.status_code == 200, res.text
    assert (await get_record(db, "discussion", did))["created_by_id"] == ws["u2"]
    assert (await get_record(db, "comment", cid))["created_by_id"] == ws["u2"]
    block = await get_record(db, "block", bid)
    assert block["created_by_id"] == ws["u2"] and block["created_by_table"] == "lit_user"


async def test_created_notification_cannot_be_redirected(client, db, ws):
    nid = new_id()
    res = await apply(client, tx(
        op("notification", nid, [], "set", {"user_id": ws["u1"], "type": "mention", "space_id": ws["space"]}),
        op("notification", nid, [], "update", {"user_id": ws["u2"], "actor_id": "ceo"}),
    ))
    assert res.status_code == 403
    assert await get_record(db, "notification", nid) is None


async def test_created_space_view_cannot_be_given_away(client, db, ws):
    sv = new_id()
    res = await apply(client, tx(
        op("space_view", sv, [], "set", {"parent_id": ws["u1"], "parent_table": "user_root", "space_id": ws["space"]}),
        op("space_view", sv, ["parent_id"], "set", ws["u2"]),
    ))
    assert res.status_code == 403
    assert await get_record(db, "space_view", sv) is None


async def test_created_team_cannot_move_to_foreign_workspace(client, db, ws):
    await as_user(client, "lee@example.com")
    foreign = (await call(client, "createWorkspace", {"name": "남의 곳"})).json()["spaceId"]
    await as_user(client, "hong@example.com")
    tid = new_id()
    res = await apply(client, tx(
        op("team", tid, [], "set", {"name": "몰래", "space_id": ws["space"], "parent_id": ws["space"],
                                    "parent_table": "space", "alive": True, "membership": []}),
        op("team", tid, [], "update", {"space_id": foreign, "parent_id": foreign,
                                       "membership": [{"user_id": ws["u1"], "role": "owner"}]}),
    ))
    assert res.status_code == 403
    assert await get_record(db, "team", tid) is None


async def test_created_follow_cannot_point_at_unreadable_block(client, db, ws):
    await as_user(client, "kim@example.com")
    fid = new_id()
    res = await apply(client, tx(
        op("follow", fid, [], "set", {"user_id": ws["u2"], "navigable_block_id": ws["team_home"], "following": True}),
        op("follow", fid, ["navigable_block_id"], "set", ws["welcome"]),  # u1의 비공개 페이지
    ))
    assert res.status_code == 403
    assert await get_record(db, "follow", fid) is None


async def test_created_page_visit_cannot_be_reassigned(client, db, ws):
    vid = f"{ws['u1']}:{ws['welcome']}"
    res = await apply(client, tx(
        op("page_visit", vid, [], "set", {"user_id": ws["u1"], "parent_id": ws["welcome"], "visited_at": 1}),
        op("page_visit", vid, ["user_id"], "set", ws["u2"]),
    ))
    assert res.status_code == 403
    assert await get_record(db, "page_visit", vid) is None


@pytest.mark.parametrize("table,field", [
    ("page_visit", "parent_id"), ("page_visit", "space_id"), ("notification", "space_id"),
    ("space_view", "space_id"), ("follow", "space_id"), ("page_visit", "parent_table"),
])
async def test_too_long_index_values_400(client, ws, table, field):
    # 압축이 잘 안 되는 임의 값이어야 B-tree 색인 한도를 넘는다(같은 글자 반복은 압축돼 들어간다)
    rec = {"user_id": ws["u1"], "parent_id": ws["u1"], "navigable_block_id": ws["welcome"], field: secrets.token_hex(5000)}
    res = await apply(client, tx(op(table, new_id(), [], "set", rec)))
    assert res.status_code == 400
