from app.records.permissions import Lookup
from app.records.recordmap import RecordMapBuilder
from app.records.store import put_record


def _perm(user_id: str, role: str) -> dict:
    return {"type": "user_permission", "role": role, "user_id": user_id}


async def _save(db, table: str, rec: dict) -> dict:
    rec = {"version": 1, "alive": True, **rec}
    await put_record(db, table, rec)
    return rec


async def _member_of(db, user_id: str, space_id: str) -> None:
    """user_root.space_views → space_view로 공간 멤버임을 남긴다."""
    sv_id = f"sv-{user_id}-{space_id}"
    await _save(db, "space_view", {"id": sv_id, "parent_id": user_id, "parent_table": "user_root", "space_id": space_id})
    await _save(db, "user_root", {"id": user_id, "space_views": [sv_id]})


async def test_recordmap_shape_and_skip_none(db):
    await _save(db, "space", {"id": "s1", "permissions": [_perm("u1", "owner")]})
    page = await _save(
        db, "block", {"id": "p", "type": "page", "space_id": "s1", "parent_table": "space", "parent_id": "s1",
                      "permissions": [_perm("u1", "editor")]}
    )
    hidden = await _save(
        db, "block", {"id": "h", "type": "page", "space_id": "s1", "parent_table": "space", "parent_id": "s1",
                      "permissions": [_perm("u2", "editor")]}
    )
    b = RecordMapBuilder(Lookup(db), "u1")
    await b.add("block", page)
    await b.add("block", hidden)
    await b.add("block", None)
    assert b.map["__version__"] == 3
    assert b.map["block"]["p"] == {"spaceId": "s1", "value": {"value": page, "role": "editor"}}
    assert "h" not in b.map["block"]
    assert b.has("block", "p")
    assert not b.has("block", "h")
    assert not b.has("space", "s1")

    # 역할을 넘기면 다시 계산하지 않는다
    await b.add("block", hidden, role="reader")
    assert b.map["block"]["h"]["value"]["role"] == "reader"
    await b.add("block", {"id": "z", "space_id": "s1"}, role="none")
    assert not b.has("block", "z")


async def test_recordmap_hides_email_from_non_members(db):
    await _save(db, "space", {"id": "s1", "permissions": [_perm("u1", "owner"), _perm("u2", "editor"), _perm("u4", "none")]})
    await _save(db, "space", {"id": "s2", "permissions": [_perm("u3", "owner")]})
    await _member_of(db, "u1", "s1")
    users = {uid: {"id": uid, "name": uid, "email": f"{uid}@example.com"} for uid in ("u1", "u2", "u3", "u4")}

    b = RecordMapBuilder(Lookup(db), "u1")
    for rec in users.values():
        await b.add("lit_user", rec)
    got = {uid: entry["value"]["value"] for uid, entry in b.map["lit_user"].items()}
    assert got["u1"]["email"] == "u1@example.com"  # 본인
    assert got["u2"]["email"] == "u2@example.com"  # 같은 공간 멤버
    assert "email" not in got["u3"]  # 다른 공간 사람
    assert "email" not in got["u4"]  # 공간 권한이 none
    assert got["u3"]["name"] == "u3"
    assert users["u3"]["email"] == "u3@example.com"  # 원본 레코드는 건드리지 않는다
    assert b.map["lit_user"]["u3"]["value"]["role"] == "reader"

    # 익명은 이메일을 못 보지만 이름은 보인다(lit_user는 역할이 none이어도 넣는다)
    anon = RecordMapBuilder(Lookup(db), None)
    await anon.add("lit_user", users["u2"])
    assert anon.map["lit_user"]["u2"] == {"spaceId": None, "value": {"value": {"id": "u2", "name": "u2"}, "role": "none"}}


async def test_recordmap_viewer_without_spaces_sees_no_emails(db):
    await _save(db, "space", {"id": "s1", "permissions": [_perm("u1", "owner"), _perm("u2", "editor")]})
    # u1은 공간 권한은 있지만 자기 space_view가 없으면 멤버 공간으로 치지 않는다(원본 memberSpaceIds)
    b = RecordMapBuilder(Lookup(db), "u1")
    await b.add("lit_user", {"id": "u2", "email": "u2@example.com"})
    assert "email" not in b.map["lit_user"]["u2"]["value"]["value"]
