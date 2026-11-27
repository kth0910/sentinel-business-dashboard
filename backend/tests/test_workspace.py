import pytest

from app.auth.users import create_user
from app.records.store import records_in_space


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


def _values(record_map, table):
    return [e["value"]["value"] for e in record_map.get(table, {}).values()]


def _text(block):
    return "".join(part[0] for part in block.get("properties", {}).get("title", []))


async def test_load_account_data_creates_user_records(client, u1):
    await sign_in(client, "hong@example.com")
    data = (await call(client, "loadAccountData")).json()
    rm = data["recordMap"]
    assert u1.id in rm["lit_user"] and u1.id in rm["user_root"] and u1.id in rm["user_settings"]
    settings = rm["user_settings"][u1.id]["value"]["value"]["settings"]
    assert settings["locale"] == "ko-KR" and settings["time_zone"] == "Asia/Seoul"
    assert data["lsn"] > 0


async def test_create_workspace_then_load_account_data(client, u1):
    await sign_in(client, "hong@example.com")
    res = await call(client, "createWorkspace", {"name": "영업팀"})
    assert res.status_code == 200
    space_id = res.json()["spaceId"]
    assert space_id and res.json()["recordMap"] == {"__version__": 3}

    data = (await call(client, "loadAccountData")).json()
    rm = data["recordMap"]
    space = rm["space"][space_id]["value"]
    assert space["value"]["name"] == "영업팀" and space["role"] == "editor"
    assert space["value"]["settings"] == {
        "allow_members_to_create_pages": True, "allow_guests": False, "allow_public_pages": False,
    }
    assert [t["name"] for t in _values(rm, "team")] == ["일반"]
    views = _values(rm, "space_view")
    assert len(views) == 1 and len(views[0]["private_pages"]) == 1
    titles = [_text(b) for b in _values(rm, "block")]
    assert "CoolNotion!에 오신 것을 환영합니다" in titles
    assert "팀 홈" in titles
    assert rm["user_root"][u1.id]["value"]["value"]["space_views"] == [views[0]["id"]]
    assert data["lsn"] > 0


async def test_create_workspace_blank_name_uses_default(client, u1):
    await sign_in(client, "hong@example.com")
    space_id = (await call(client, "createWorkspace", {"name": "  "})).json()["spaceId"]
    rm = (await call(client, "loadAccountData")).json()["recordMap"]
    assert rm["space"][space_id]["value"]["value"]["name"] == "내 워크스페이스"


async def test_create_workspace_requires_login(client):
    res = await call(client, "createWorkspace", {"name": "영업팀"})
    assert res.status_code == 401


async def test_other_user_does_not_see_workspace(client, u1, u2):
    await sign_in(client, "hong@example.com")
    space_id = (await call(client, "createWorkspace", {"name": "영업팀"})).json()["spaceId"]
    await call(client, "signOut")
    await sign_in(client, "kim@example.com")
    rm = (await call(client, "loadAccountData")).json()["recordMap"]
    assert space_id not in rm.get("space", {})
    assert rm.get("block", {}) == {} and rm.get("team", {}) == {}


async def test_welcome_page_has_no_ai_line(client, db, u1):
    await sign_in(client, "hong@example.com")
    space_id = (await call(client, "createWorkspace", {"name": "영업팀"})).json()["spaceId"]
    blocks = await records_in_space(db, "block", space_id)
    # 환영 페이지 본문 블록까지 포함해 모두 확인한다
    assert len(blocks) >= 9
    for b in blocks:
        assert "AI" not in _text(b)
