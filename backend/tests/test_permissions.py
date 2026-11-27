from app.records.permissions import (
    RANK,
    Lookup,
    effective_role,
    max_role,
    record_role,
    role_at_least,
)
from app.records.store import now_ms, put_record


def _perm(user_id: str, role: str) -> dict:
    return {"type": "user_permission", "role": role, "user_id": user_id}


async def _save(db, table: str, rec: dict) -> dict:
    rec = {"version": 1, "alive": True, **rec}
    await put_record(db, table, rec)
    return rec


async def _space(db, **extra) -> dict:
    """공간 s1: u1 owner, u2 editor."""
    return await _save(db, "space", {"id": "s1", "permissions": [_perm("u1", "owner"), _perm("u2", "editor")], **extra})


async def _page(db, id: str, parent_table: str = "space", parent_id: str = "s1", **extra) -> dict:
    return await _save(
        db, "block", {"id": id, "type": "page", "space_id": "s1", "parent_table": parent_table, "parent_id": parent_id, **extra}
    )


def test_rank_and_helpers():
    assert RANK == {
        "none": 0, "reader": 1, "comment_only": 2, "content_only_editor": 2.5,
        "read_and_write": 3, "editor": 4, "membership_admin": 5, "owner": 6,
    }
    assert max_role("reader", "editor") == "editor"
    assert max_role("editor", "reader") == "editor"
    assert max_role("모름", "none") == "모름"  # 같은 순위면 앞의 값
    assert role_at_least("editor", "read_and_write")
    assert not role_at_least("reader", "comment_only")
    assert not role_at_least(None, "reader")
    assert role_at_least(None, "none")


async def test_private_page_only_for_listed_user(db):
    await _space(db)
    await _page(db, "p", permissions=[_perm("u1", "editor")])
    lk = Lookup(db)
    assert await effective_role(lk, "p", "u1") == "editor"
    assert await effective_role(lk, "p", "u2") == "none"
    assert await effective_role(lk, "p", None) == "none"


async def test_workspace_page_falls_back_to_space_role(db):
    await _space(db)
    await _page(db, "w")
    lk = Lookup(db)
    assert await effective_role(lk, "w", "u2") == "editor"
    assert await effective_role(lk, "w", "u1") == "editor"  # owner는 페이지에서 editor
    assert await effective_role(lk, "w", "outsider") == "none"
    assert await effective_role(lk, "w", None) == "none"
    assert await effective_role(lk, "없는블록", "u1") == "none"


async def test_child_block_inherits_from_page(db):
    await _space(db)
    await _page(db, "p", permissions=[_perm("u1", "editor")])
    await _page(db, "c", parent_table="block", parent_id="p", type="text")
    lk = Lookup(db)
    assert await effective_role(lk, "c", "u1") == "editor"
    assert await effective_role(lk, "c", "u2") == "none"


async def test_explicit_permissions_union_down_the_tree(db):
    await _space(db)
    await _page(db, "p", permissions=[_perm("u1", "editor")])
    await _page(db, "c", parent_table="block", parent_id="p", permissions=[_perm("u2", "reader")])
    lk = Lookup(db)
    assert await effective_role(lk, "c", "u1") == "editor"
    assert await effective_role(lk, "c", "u2") == "reader"


async def test_permissions_unlinked_stops_inheritance(db):
    await _space(db)
    await _page(db, "p", permissions=[_perm("u1", "editor")])
    await _page(
        db, "c", parent_table="block", parent_id="p", permissions=[_perm("u2", "reader")], permissions_unlinked=True
    )
    lk = Lookup(db)
    assert await effective_role(lk, "c", "u1") == "none"
    assert await effective_role(lk, "c", "u2") == "reader"


async def test_space_permission_for_members_only(db):
    await _space(db)
    await _page(db, "p", permissions=[{"type": "space_permission", "role": "comment_only"}])
    lk = Lookup(db)
    assert await effective_role(lk, "p", "u2") == "comment_only"
    assert await effective_role(lk, "p", "outsider") == "none"


async def test_public_permission_capped_and_expiry(db):
    await _space(db)
    await _page(db, "p", permissions=[{"type": "public_permission", "role": "editor"}])
    await _page(db, "r", permissions=[{"type": "public_permission", "role": "reader"}])
    await _page(db, "x", permissions=[{"type": "public_permission", "role": "reader", "expiry_time": now_ms() - 1000}])
    lk = Lookup(db)
    # 웹 링크는 최대 read_and_write까지만 준다
    assert await effective_role(lk, "p", None) == "read_and_write"
    assert await effective_role(lk, "r", "outsider") == "reader"
    assert await effective_role(lk, "x", None) == "none"


async def test_team_permission(db):
    await _space(db)
    await _save(db, "team", {"id": "t1", "space_id": "s1", "membership": [{"user_id": "u2", "role": "member"}]})
    await _page(db, "p", permissions=[{"type": "team_permission", "role": "reader", "team_id": "t1"}])
    lk = Lookup(db)
    assert await effective_role(lk, "p", "u2") == "reader"
    assert await effective_role(lk, "p", "u1") == "none"


async def test_team_page_role(db):
    await _space(db, permissions=[_perm("u1", "owner"), _perm("u2", "editor"), _perm("u3", "editor")])
    team = await _save(
        db,
        "team",
        {
            "id": "t1",
            "space_id": "s1",
            "settings": {"type": "open", "default_page_role": "editor"},
            "membership": [{"user_id": "u1", "role": "owner"}, {"user_id": "u3", "role": "member"}],
        },
    )
    await _page(db, "tp", parent_table="team", parent_id="t1")
    lk = Lookup(db)
    assert await effective_role(lk, "tp", "u1") == "editor"
    assert await effective_role(lk, "tp", "u3") == "editor"
    assert await effective_role(lk, "tp", "u2") == "read_and_write"
    assert await effective_role(lk, "tp", "outsider") == "none"

    await _save(db, "team", {**team, "settings": {"type": "private", "default_page_role": "editor"}})
    lk = Lookup(db)
    assert await effective_role(lk, "tp", "u2") == "none"
    assert await effective_role(lk, "tp", "u1") == "editor"


async def test_database_row_inherits_from_database_block(db):
    await _space(db)
    await _page(db, "dbp", permissions=[_perm("u1", "editor")], type="collection_view_page")
    await _save(db, "collection", {"id": "col", "space_id": "s1", "parent_table": "block", "parent_id": "dbp"})
    await _page(db, "row", parent_table="collection", parent_id="col")
    lk = Lookup(db)
    assert await effective_role(lk, "row", "u1") == "editor"
    assert await effective_role(lk, "row", "u2") == "none"


async def test_lookup_memoizes_and_override(db):
    await _space(db)
    lk = Lookup(db)
    first = await lk.space("s1")
    await _save(db, "space", {"id": "s1", "permissions": []})
    assert await lk.space("s1") == first  # 같은 Lookup은 처음 읽은 값을 기억한다
    assert await Lookup(db).space("s1") != first

    lk.override("space", {"id": "s1", "permissions": [_perm("u9", "editor")]})
    assert (await lk.get("space", "s1"))["permissions"] == [_perm("u9", "editor")]
    lk.override("block", {"id": "new", "space_id": "s1", "parent_table": "space", "parent_id": "s1"})
    assert await effective_role(lk, "new", "u9") == "editor"
    assert await lk.block(None) is None


async def test_record_role_tables(db):
    space = await _space(db)
    lk = Lookup(db)
    assert await record_role(lk, "space", space, "u1") == "editor"
    assert await record_role(lk, "space", space, "u2") == "read_and_write"
    assert await record_role(lk, "space", space, "outsider") == "none"
    assert await record_role(lk, "space", space, None) == "none"

    sv = {"id": "sv1", "parent_id": "u1", "parent_table": "user_root", "space_id": "s1"}
    assert await record_role(lk, "space_view", sv, "u1") == "editor"
    assert await record_role(lk, "space_view", sv, "u2") == "none"

    for table in ("user_root", "user_settings"):
        assert await record_role(lk, table, {"id": "u1"}, "u1") == "editor"
        assert await record_role(lk, table, {"id": "u1"}, "u2") == "none"

    assert await record_role(lk, "lit_user", {"id": "u1"}, "u1") == "editor"
    assert await record_role(lk, "lit_user", {"id": "u1"}, "u2") == "reader"
    assert await record_role(lk, "lit_user", {"id": "u1"}, None) == "none"

    for table in ("page_visit", "notification", "follow"):
        rec = {"id": "x1", "user_id": "u1"}
        assert await record_role(lk, table, rec, "u1") == "editor"
        assert await record_role(lk, table, rec, "u2") == "none"
        assert await record_role(lk, table, rec, None) == "none"

    assert await record_role(lk, "block", None, "u1") == "none"
    assert await record_role(lk, "workflow", {"id": "wf", "space_id": "s1"}, "u1") == "none"


async def test_record_role_team(db):
    await _space(db, permissions=[_perm("u1", "owner"), _perm("u2", "editor"), _perm("u3", "editor")])
    team = {"id": "t1", "space_id": "s1", "settings": {"type": "private"}, "membership": [{"user_id": "u3", "role": "member"}]}
    lk = Lookup(db)
    assert await record_role(lk, "team", team, "u1") == "editor"  # 공간 관리자
    assert await record_role(lk, "team", team, "u3") == "read_and_write"
    assert await record_role(lk, "team", team, "u2") == "none"  # private 팀 밖
    assert await record_role(lk, "team", {**team, "settings": {"type": "open"}}, "u2") == "read_and_write"
    owner_team = {**team, "membership": [{"user_id": "u3", "role": "owner"}]}
    assert await record_role(lk, "team", owner_team, "u3") == "editor"
    assert await record_role(lk, "team", team, "outsider") == "none"


async def test_record_role_follows_parent_block(db):
    await _space(db)
    await _page(db, "p", permissions=[_perm("u1", "editor")])
    await _save(db, "collection", {"id": "col", "space_id": "s1", "parent_table": "block", "parent_id": "p"})
    await _save(db, "discussion", {"id": "d1", "space_id": "s1", "parent_table": "block", "parent_id": "p"})
    lk = Lookup(db)
    cases = {
        "collection": {"id": "col", "parent_id": "p"},
        "collection_view": {"id": "cv", "parent_id": "p"},
        "discussion": {"id": "d1", "parent_id": "p"},
        "comment": {"id": "cm", "parent_id": "d1"},
        "automation": {"id": "a1", "parent_table": "collection", "parent_id": "col"},
    }
    for table, rec in cases.items():
        assert await record_role(lk, table, rec, "u1") == "editor", table
        assert await record_role(lk, table, rec, "u2") == "none", table
    assert await record_role(lk, "comment", {"id": "cm", "parent_id": "없음"}, "u1") == "none"
    assert await record_role(lk, "collection", {"id": "col"}, "u1") == "none"
    assert await record_role(lk, "automation", {"id": "a1", "parent_table": "block", "parent_id": "p"}, "u1") == "none"
    block = await lk.block("p")
    assert await record_role(lk, "block", block, "u1") == "editor"
