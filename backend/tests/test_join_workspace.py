import pytest

from app.dev.join_workspace import join_workspace
from app.records.seed import add_member
from app.records.store import get_record
from tests.test_workspace import _values, call, sign_in, u1, u2  # noqa: F401


async def _make_space(client):
    await sign_in(client, "hong@example.com")
    return (await call(client, "createWorkspace", {"name": "영업팀"})).json()["spaceId"]


async def test_add_member_creates_sidebar(client, db, u1, u2):
    space_id = await _make_space(client)
    client.cookies.clear()
    await call(client, "signOut")
    # u2는 아직 로그인해 본 적 없으므로 user 레코드가 없다 -> join_workspace가 만든다
    await join_workspace(db, "kim@example.com", space_id, "editor", "development")

    await sign_in(client, "kim@example.com")
    rm = (await call(client, "loadAccountData")).json()["recordMap"]
    space = rm["space"][space_id]["value"]
    assert space["role"] == "read_and_write"  # 로더가 editor를 이렇게 내보낸다
    assert [t["name"] for t in _values(rm, "team")] == ["일반"]
    views = _values(rm, "space_view")
    assert len(views) == 1 and views[0]["space_id"] == space_id
    team = (await get_record(db, "team", views[0]["joined_teams"][0]))
    assert {m["user_id"]: m["role"] for m in team["membership"]}[u2.id] == "member"


async def test_add_member_is_idempotent_and_updates_role(client, db, u1, u2):
    space_id = await _make_space(client)
    await join_workspace(db, "kim@example.com", space_id, "reader", "development")
    await join_workspace(db, "kim@example.com", space_id, "editor", "development")
    space = await get_record(db, "space", space_id)
    perms = [p for p in space["permissions"] if p["user_id"] == u2.id]
    assert len(perms) == 1 and perms[0]["role"] == "editor"
    root = await get_record(db, "user_root", u2.id)
    assert len(root["space_views"]) == 1
    team = await get_record(db, "team", space["default_team_ids"][0])
    assert sum(1 for m in team["membership"] if m["user_id"] == u2.id) == 1


async def test_add_member_unknown_space_raises(db, u1):
    with pytest.raises(ValueError):
        await add_member(db, "no-such-space", u1.id, "editor")


async def test_join_workspace_unknown_email_and_space(client, db, u1):
    space_id = await _make_space(client)
    with pytest.raises(ValueError, match="등록되지 않은 이메일"):
        await join_workspace(db, "nobody@example.com", space_id, "editor", "development")
    with pytest.raises(ValueError, match="워크스페이스를 찾을 수 없습니다"):
        await join_workspace(db, "hong@example.com", "no-such-space", "editor", "development")


async def test_join_workspace_refused_in_production(client, db, u1, u2):
    space_id = await _make_space(client)
    with pytest.raises(RuntimeError):
        await join_workspace(db, "kim@example.com", space_id, "editor", "production")
    assert await get_record(db, "user_root", u2.id) is None
